"""Middleware audit log: catat setiap request mutating ke `audit_logs` (Sprint 0, Story 5).

- Hanya POST/PUT/PATCH/DELETE yang dicatat; GET/HEAD/OPTIONS diabaikan.
- `/health` diabaikan; `/v1/auth/login` diabaikan karena login sudah diaudit
  eksplisit di endpoint (berikut keterangan sukses/gagal).
- Actor diambil dari JWT Authorization header bila ada dan valid (tanpa query DB).
- Kegagalan pencatatan audit tidak boleh menggagalkan request utama.
"""

import logging
import uuid
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.security import decode_access_token
from app.db.session import get_session_factory
from app.models import AuditLog

logger = logging.getLogger("ekoteologi.audit")

AUDITED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PATHS = {"/health", "/v1/auth/login"}


def _actor_id_from(request: Request) -> uuid.UUID | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    payload = decode_access_token(auth.removeprefix("Bearer ").strip())
    if not payload or "sub" not in payload:
        return None
    try:
        return uuid.UUID(payload["sub"])
    except ValueError:
        return None


def _route_info(request: Request) -> tuple[str, str | None, str | None]:
    """(action, entity, entity_id) dari route template; fallback ke path mentah."""
    route: Any = request.scope.get("route")
    path = getattr(route, "path", None) or request.url.path
    action = f"{request.method.lower()}:{path}"[:50]
    parts = [p for p in path.strip("/").split("/") if p]
    entity = parts[1] if len(parts) > 1 else (parts[0] if parts else None)
    path_params = request.scope.get("path_params") or {}
    entity_id = path_params.get("id")
    return action, entity, str(entity_id) if entity_id is not None else None


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        should_audit = (
            request.method in AUDITED_METHODS
            and request.url.path not in SKIP_PATHS
            and not request.url.path.startswith("/docs")
            and not request.url.path.startswith("/openapi")
        )
        if not should_audit:
            return response

        action, entity, entity_id = _route_info(request)
        try:
            async with get_session_factory()() as session:
                session.add(
                    AuditLog(
                        actor_id=_actor_id_from(request),
                        action=action,
                        entity=entity,
                        entity_id=entity_id,
                        diff={
                            "method": request.method,
                            "path": request.url.path,
                            "status_code": response.status_code,
                        },
                    )
                )
                await session.commit()
        except Exception:  # noqa: BLE001 — audit tidak boleh merusak request utama
            logger.warning(
                "Gagal menulis audit log untuk %s %s",
                request.method,
                request.url.path,
                exc_info=True,
            )

        return response
