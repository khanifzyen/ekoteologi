"""Dashboard admin (Sprint 3–4): KPI cards + 2 chart + biaya LLM.

- `GET /v1/admin/kpi`    — 4 kartu mockup (`admin/index.html`): pengguna, scan,
  antrian verifikasi, dan (Sprint 4) **Biaya LLM** — estimasi dari token
  tercatat bulan berjalan (`llm_meta.tokens`) × `LLM_COST_PER_1K_TOKENS`;
  mock mode tidak memakai token → Rp0 (plan §5.3).
- `GET /v1/admin/charts` — data 2 chart: scan harian N hari & komposisi
  kategori 7 hari (ditampilkan ChartLine/ChartBar gaya editorial).

Akses: role panel (admin|verifier|editor), read-only.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_db, get_redis_dep, require_roles
from app.models import Scan, User, UserMission, WasteCategory
from app.schemas.dashboard import (
    CacheKpi,
    CategoryCount,
    ChartsOut,
    DailyCount,
    DashboardKpiOut,
    LlmKpi,
    ScansKpi,
    UsersKpi,
    VerificationKpi,
)
from app.services import scan_cache

router = APIRouter(prefix="/v1/admin", tags=["admin"])


async def _count(db: AsyncSession, stmt) -> int:
    return int(await db.scalar(stmt) or 0)


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def _llm_tokens_month(db: AsyncSession, now: datetime) -> int:
    """Total token LLM bulan berjalan (dari `llm_meta.tokens.total_tokens`).

    Baris hasil cache menyalin meta panggilan asli — agar token tidak dihitung
    ganda, hanya baris dengan `llm_meta.cached != true` yang dijumlahkan
    (mock mode menyimpan `tokens: None` → 0).
    """
    tokens = Scan.llm_meta["tokens"]["total_tokens"].as_integer()
    cached_flag = Scan.llm_meta["cached"].as_boolean()
    row = await db.execute(
        select(func.coalesce(func.sum(tokens), 0)).where(
            Scan.created_at >= _month_start(now),
            func.coalesce(cached_flag, False).is_(False),
        )
    )
    return int(row.scalar_one() or 0)


@router.get("/kpi", response_model=DashboardKpiOut)
async def dashboard_kpi(
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis_dep),
) -> DashboardKpiOut:
    now = datetime.now().astimezone()
    week_ago = now - timedelta(days=7)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)

    users_total = await _count(db, select(func.count()).select_from(User))
    users_new = await _count(
        db, select(func.count()).select_from(User).where(User.created_at >= week_ago)
    )
    scans_total = await _count(db, select(func.count()).select_from(Scan))
    scans_today = await _count(
        db, select(func.count()).select_from(Scan).where(Scan.created_at >= start_of_day)
    )
    # Status 'pending' = bukti menunggu review (terisi mulai Sprint 4).
    verif_pending = await _count(
        db,
        select(func.count()).select_from(UserMission).where(UserMission.status == "pending"),
    )

    stats = await scan_cache.cache_stats(redis)
    total_hits = stats["hit"] + stats["miss"]
    hit_rate = round(stats["hit"] / total_hits * 100, 1) if total_hits else None

    settings = get_settings()
    tokens_month = await _llm_tokens_month(db, now)
    return DashboardKpiOut(
        users=UsersKpi(total=users_total, new_7d=users_new),
        scans=ScansKpi(today=scans_today, total=scans_total),
        verification=VerificationKpi(pending=verif_pending),
        cache=CacheKpi(hit=stats["hit"], miss=stats["miss"], hit_rate=hit_rate),
        llm=LlmKpi(
            cost_month=round(tokens_month / 1000 * settings.llm_cost_per_1k_tokens, 2),
            tokens_month=tokens_month,
            budget_monthly=settings.llm_budget_monthly or None,
        ),
    )


@router.get("/charts", response_model=ChartsOut)
async def dashboard_charts(
    days: int = Query(default=14, ge=7, le=30),
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> ChartsOut:
    """Data chart garis (scan harian `days` hari) + batang (kategori 7 hari)."""
    now = datetime.now().astimezone()
    start = (now - timedelta(days=days - 1)).date()

    # Scan harian — bucket per tanggal zona server (Python, agar konsisten dgn
    # `start` lokal; `date()` di Postgres memakai zona sesi DB yang bisa beda).
    created_rows = await db.scalars(
        select(Scan.created_at).where(Scan.created_at >= now - timedelta(days=days))
    )
    by_date: dict = {}
    for created in created_rows:
        key = created.astimezone().date()
        by_date[key] = by_date.get(key, 0) + 1
    daily = [
        DailyCount(date=start + timedelta(days=i), count=by_date.get(start + timedelta(days=i), 0))
        for i in range(days)
    ]

    # Kategori 7 hari terakhir (join waste_categories) — terbanyak lebih dulu.
    week_ago = now - timedelta(days=7)
    cat_rows = await db.execute(
        select(WasteCategory.name, WasteCategory.icon, func.count())
        .select_from(Scan)
        .join(WasteCategory, Scan.category_id == WasteCategory.id)
        .where(Scan.created_at >= week_ago)
        .group_by(WasteCategory.name, WasteCategory.icon)
        .order_by(func.count().desc())
    )
    raw = [(name, icon, int(c)) for name, icon, c in cat_rows.all()]
    total = sum(c for _, _, c in raw)
    categories = [
        CategoryCount(
            name=name,
            icon=icon,
            count=count,
            percentage=round(count / total * 100, 1) if total else 0.0,
        )
        for name, icon, count in raw
    ]

    return ChartsOut(days=days, daily=daily, categories=categories, categories_total=total)
