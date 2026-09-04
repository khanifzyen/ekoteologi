"""Dashboard admin (Sprint 3): KPI cards read-only — `GET /v1/admin/kpi`.

Data agregat dari tabel users/scans/user_missions + penghitung cache Redis.
Read-only: tidak ada endpoint tulis di sini — modul CRUD admin menyusul
Sprint 4–7. Akses: role panel (admin|verifier|editor).
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_redis_dep, require_roles
from app.models import Scan, User, UserMission
from app.schemas.dashboard import (
    CacheKpi,
    DashboardKpiOut,
    ScansKpi,
    UsersKpi,
    VerificationKpi,
)
from app.services import scan_cache

router = APIRouter(prefix="/v1/admin", tags=["admin"])


async def _count(db: AsyncSession, stmt) -> int:
    return int(await db.scalar(stmt) or 0)


@router.get("/kpi", response_model=DashboardKpiOut)
async def dashboard_kpi(
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis_dep),
) -> DashboardKpiOut:
    week_ago = datetime.now().astimezone() - timedelta(days=7)
    start_of_day = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)

    users_total = await _count(db, select(func.count()).select_from(User))
    users_new = await _count(
        db, select(func.count()).select_from(User).where(User.created_at >= week_ago)
    )
    scans_total = await _count(db, select(func.count()).select_from(Scan))
    scans_today = await _count(
        db, select(func.count()).select_from(Scan).where(Scan.created_at >= start_of_day)
    )
    # Status 'pending' = bukti menunggu review (dipakai mulai Sprint 4).
    verif_pending = await _count(
        db,
        select(func.count()).select_from(UserMission).where(UserMission.status == "pending"),
    )

    stats = await scan_cache.cache_stats(redis)
    total_hits = stats["hit"] + stats["miss"]
    hit_rate = round(stats["hit"] / total_hits * 100, 1) if total_hits else None

    return DashboardKpiOut(
        users=UsersKpi(total=users_total, new_7d=users_new),
        scans=ScansKpi(today=scans_today, total=scans_total),
        verification=VerificationKpi(pending=verif_pending),
        cache=CacheKpi(hit=stats["hit"], miss=stats["miss"], hit_rate=hit_rate),
    )
