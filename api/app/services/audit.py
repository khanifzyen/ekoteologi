"""Service audit log: satu pintu penulisan `audit_logs` (PRD §5.9)."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


async def record_audit(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    action: str,
    entity: str,
    entity_id: str | None = None,
    diff: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action[:50],
            entity=entity[:30],
            entity_id=str(entity_id) if entity_id is not None else None,
            diff=diff,
        )
    )
    await db.commit()
