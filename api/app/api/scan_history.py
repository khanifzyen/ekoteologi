"""Riwayat scan & kuota harian (Sprint 3) — dikonsumsi layar Scan + Riwayat mobile.

- `GET /v1/scans`            — daftar scan milik user sendiri (filter kategori,
  offset pagination, terbaru lebih dulu).
- `GET /v1/scans/categories` — daftar kategori sampah (filter chips).
- `GET /v1/scans/quota`      — pemakaian kuota harian (`SCAN_DAILY_LIMIT`) tanpa
  mengkonsumsi slot; bila Redis mati → 503 dan UI menyembunyikan pill kuota
  (bukan memblokir — kontras dgn `POST /v1/scan` yang fail-closed mutlak).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, get_redis_dep
from app.models import Scan, User, WasteCategory
from app.schemas.scan import (
    ScanCategoryFullOut,
    ScanHistoryItem,
    ScanHistoryPage,
    ScanQuotaOut,
)
from app.services import scan_limit

router = APIRouter(prefix="/v1/scans", tags=["scan"])


@router.get("/categories", response_model=list[ScanCategoryFullOut])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[ScanCategoryFullOut]:
    """Daftar kategori sampah (seed) — filter chips layar Riwayat."""
    rows = (await db.scalars(select(WasteCategory).order_by(WasteCategory.name.asc()))).all()
    return [ScanCategoryFullOut.model_validate(r, from_attributes=True) for r in rows]


@router.get("/quota", response_model=ScanQuotaOut)
async def scan_quota(
    user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis_dep),
) -> ScanQuotaOut:
    peek = await scan_limit.peek_quota(redis, user.id)
    if peek is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Info kuota scan sedang tidak tersedia. Scan tetap bisa dicoba.",
        )
    used, limit = peek
    return ScanQuotaOut(
        used=used,
        limit=limit,
        remaining=max(0, limit - used),
        resets_in_seconds=scan_limit.seconds_until_reset(),
    )


@router.get("", response_model=ScanHistoryPage)
async def list_scans(
    category_id: int | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanHistoryPage:
    """Riwayat scan milik user yang sedang masuk (terbaru lebih dulu)."""
    filters = [Scan.user_id == user.id]
    if category_id is not None:
        filters.append(Scan.category_id == category_id)

    total = await db.scalar(select(func.count()).select_from(Scan).where(*filters))

    rows = (
        await db.execute(
            select(Scan, WasteCategory)
            .join(WasteCategory, Scan.category_id == WasteCategory.id, isouter=True)
            .where(*filters)
            .order_by(Scan.created_at.desc(), Scan.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()

    items = [
        ScanHistoryItem(
            id=scan.id,
            item_name=scan.item_name,
            category=(
                ScanCategoryFullOut.model_validate(cat, from_attributes=True) if cat else None
            ),
            points=scan.points,
            image_url=scan.image_url,
            created_at=scan.created_at,
        )
        for scan, cat in rows
    ]
    return ScanHistoryPage(items=items, total=int(total or 0), limit=limit, offset=offset)
