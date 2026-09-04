"""Endpoint baca audit log (khusus admin) — bukti kerja middleware Sprint 0."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import AuditLog
from app.schemas.auth import AuditLogPage

router = APIRouter(prefix="/v1/audit-logs", tags=["audit"])


@router.get("", response_model=AuditLogPage)
async def list_audit_logs(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_roles("admin")),
) -> AuditLogPage:
    items = (
        await db.scalars(
            select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    return AuditLogPage(items=list(items), limit=limit, offset=offset)


@router.get("/count")
async def count_audit_logs(
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_roles("admin")),
) -> dict:
    total = await db.scalar(select(func.count()).select_from(AuditLog))
    return {"total": int(total or 0)}
