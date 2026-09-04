"""Admin: rekap event metrik (Sprint 8 — persiapan metrik PRD §8 / plan §5.3).

Semua event wajib PRD §8 sudah tercatat sejak sprint masing-masing lewat
`track_event()` (`analytics_events` append-only): `scan_pertama` (Sprint 3),
`misi_selesai` (Sprint 5), `streak_hari` (Sprint 5), `modul_selesai`
(Sprint 7). Endpoint ini membacanya kembali sebagai angka siap-dashboar:
total per nama + bucket harian pada jendela N hari — bahan verifikasi
target PRD §8 (aktivasi ≥40%, D7, misi/minggu, modul) tanpa query manual.

Read-only untuk role panel (pola endpoint admin baca lainnya).
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import DATE
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import AnalyticsEvent, User
from app.services.metrics import KNOWN_EVENTS

router = APIRouter(prefix="/v1/admin", tags=["admin"])


class EventTotal(BaseModel):
    name: str
    count: int


class DayBucket(BaseModel):
    date: str
    counts: dict[str, int]


class EventsMetricsOut(BaseModel):
    days: int
    from_date: str
    to_date: str
    totals: list[EventTotal]
    daily: list[DayBucket]


def _window_start(day: date) -> datetime:
    """Awal hari (datetime) dalam zona aplikasi — jendela inklusif."""
    return datetime.combine(day, time.min).astimezone()


@router.get("/metrics/events", response_model=EventsMetricsOut)
async def event_metrics(
    days: int = Query(default=30, ge=1, le=90),
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> EventsMetricsOut:
    """Rekap event `analytics_events` (PRD §8): total per nama + per hari.

    Bucket tanggal diagregasi di sisi DB (`created_at::date`) — di sini tidak
    menyangkut anti-dobel/anti-farming sehingga aman; zona tanggal mengikuti
    zona sesi DB (catatan Sprint 4 tetap berlaku untuk angka yang harus
    persis — di sini ini angka dashboard).
    """
    today = date.today()
    since = today - timedelta(days=days - 1)
    start = _window_start(since)

    total_rows = await db.execute(
        select(AnalyticsEvent.name, func.count())
        .where(AnalyticsEvent.created_at >= start)
        .group_by(AnalyticsEvent.name)
    )
    totals: dict[str, int] = {name: int(count) for name, count in total_rows.all()}

    day_col = cast(AnalyticsEvent.created_at, DATE).label("day")
    daily_rows = await db.execute(
        select(day_col, AnalyticsEvent.name, func.count())
        .where(AnalyticsEvent.created_at >= start)
        .group_by(day_col, AnalyticsEvent.name)
        .order_by(day_col)
    )
    by_day: dict[date, dict[str, int]] = {}
    for day, name, count in daily_rows.all():
        by_day.setdefault(day, {})[name] = int(count)

    # Semua nama event yang dikenal selalu muncul (count 0 jelas), urutan
    # stabil — dashboard tidak perlu menebak nama.
    return EventsMetricsOut(
        days=days,
        from_date=since.isoformat(),
        to_date=today.isoformat(),
        totals=[EventTotal(name=name, count=totals.get(name, 0)) for name in sorted(KNOWN_EVENTS)],
        daily=[
            DayBucket(date=day.isoformat(), counts=names) for day, names in sorted(by_day.items())
        ],
    )
