"""Middleware rate limit global (Sprint 8 — hardening).

Satu lapis pelindung umum untuk seluruh path `/v1/*`: fixed window per IP
per menit di Redis (`INCR` + `EXPIRE`). Melewati batas → `429` dengan
header `Retry-After`.

Kebijakan kegagalan **fail-OPEN** (kontras dengan kuota scan yang fail-
CLOSED): lapisan ini pelindung umum anti flood — bila Redis tidak dapat
dihubungi, request tetap diterima dgn warning log. Alasan: pelindung
spesifik yang melindungi sumber daya mahal tetap berjalan sendiri dan
masing-masing memilih kebijakannya (login fail-open = ketersediaan; scan
fail-closed = budget LLM nyata). Dokumentasi keputusan: laporan Sprint 8.

Per-IP: hop pertama `X-Forwarded-For` bila ada (di belakang reverse proxy),
selain itu klien langsung. `/health`, `/docs`, `/openapi*`, `/uploads` tidak
dibatasi (bukan `/v1/`). `GLOBAL_RATE_LIMIT_PER_MINUTE=0` mematikan lapisan.
"""

import logging

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.config import get_settings
from app.core.redis import get_redis

logger = logging.getLogger("ekoteologi.ratelimit")

SKIP_PREFIXES = ("/health", "/docs", "/openapi", "/uploads")
WINDOW_SECONDS = 60


def client_ip(request: Request) -> str:
    """IP klien: hop pertama X-Forwarded-For, fallback host langsung."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def rate_limit_key(ip: str) -> str:
    """Kunci Redis per lingkungan — dev/test tidak saling mengganggu."""
    return f"ratelimit:{get_settings().environment}:{ip}"


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        settings = get_settings()
        limit = settings.global_rate_limit_per_minute
        path = request.url.path

        if (
            limit <= 0
            or not path.startswith("/v1")
            or any(path.startswith(p) for p in SKIP_PREFIXES)
        ):
            return await call_next(request)

        redis = get_redis()
        try:
            key = rate_limit_key(client_ip(request))
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, WINDOW_SECONDS)
        except Exception:  # noqa: BLE001 — fail-open, ketersediaan diutamakan
            logger.warning(
                "Redis tidak tersedia — rate limit global dilewati (fail-open) utk %s %s",
                request.method,
                path,
            )
            return await call_next(request)

        if count > limit:
            ttl = await redis.ttl(key)
            retry_after = max(1, ttl if ttl and ttl > 0 else WINDOW_SECONDS)
            logger.info(
                "RATE LIMIT %s %s ip=%s count=%d (limit %d)",
                request.method,
                path,
                client_ip(request),
                count,
                limit,
            )
            return Response(
                content=('{"detail":"Terlalu banyak permintaan — coba lagi beberapa saat lagi."}'),
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(retry_after)},
            )
        return await call_next(request)
