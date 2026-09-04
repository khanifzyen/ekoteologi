"""Streak harian user (Sprint 5) — kartu streak + kalender 7 hari `beranda.html`.

`GET /v1/streak` hanya MEMBACA status (tidak menandai aktif) — aktivitas
dicatat lewat aksi nyata: scan bernilai poin, klaim misi manual, dan misi
yang disetujui verifier (`services.streak.touch_streak`).
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_db
from app.models import User
from app.schemas.gamification import StreakDay, StreakResponse
from app.services.streak import (
    active_dates_from_ledger,
    build_week,
    days_until_bonus,
    effective_streak,
)

router = APIRouter(prefix="/v1", tags=["gamification"])


@router.get("/streak", response_model=StreakResponse)
async def get_streak(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreakResponse:
    """Status streak hari ini + kalender 7 hari (dari ledger poin)."""
    settings = get_settings()
    today = datetime.now().astimezone().date()
    current = effective_streak(
        current=user.current_streak, last_active_date=user.last_active_date, today=today
    )
    active_dates = await active_dates_from_ledger(
        db, user_id=user.id, since=today - timedelta(days=6), until=today
    )
    week = build_week(today, active_dates)
    return StreakResponse(
        current_streak=current,
        longest_streak=max(user.longest_streak, current),
        active_today=user.last_active_date == today,
        last_active_date=user.last_active_date,
        bonus_points=settings.streak_bonus_points,
        bonus_every_days=settings.streak_bonus_every_days,
        days_to_bonus=days_until_bonus(current, settings.streak_bonus_every_days),
        week=[StreakDay(**day) for day in week],
    )
