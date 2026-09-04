"""Skema gamifikasi Sprint 5: streak harian & notifikasi in-app (PRD §5.9)."""

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field

# ── Streak harian (`GET /v1/streak`) ──


class StreakDay(BaseModel):
    """Satu lingkaran kalender 7 hari di kartu streak `beranda.html`."""

    date: date
    active: bool


class StreakResponse(BaseModel):
    current_streak: int  # streak efektif (0 bila sudah bolong)
    longest_streak: int
    active_today: bool
    last_active_date: date | None = None
    bonus_points: int  # nilai bonus berikutnya (0 = bonus dimatikan)
    bonus_every_days: int  # kelipatan hari bonus (0 = mati)
    days_to_bonus: int  # hari tersisa menuju bonus berikutnya
    week: list[StreakDay]  # 7 hari terakhir, elemen terakhir = hari ini


# ── Notifikasi in-app (`GET /v1/notifications`) ──


class NotificationOut(BaseModel):
    id: int
    title: str | None = None
    body: str | None = None
    type: str | None = None  # mission|streak|info|reward
    payload: dict[str, Any] | None = None
    read_at: datetime | None = None
    created_at: datetime


class NotificationsPage(BaseModel):
    items: list[NotificationOut]
    total: int
    unread_count: int
    limit: int
    offset: int


class MarkReadRequest(BaseModel):
    """Tandai notifikasi dibaca (kosong = semua)."""

    ids: list[int] = Field(default_factory=list)


# ── Leaderboard MVP (Sprint 6) — backend saja, UI penuh fase 2 (rencana §4) ──


class LeaderboardEntry(BaseModel):
    """Satu baris papan peringkat — PII minimal (nama/kota/avatar saja)."""

    rank: int
    user_id: str
    full_name: str
    avatar_url: str | None = None
    city: str | None = None
    points: int
    level: int
    level_title: str


class LeaderboardResponse(BaseModel):
    items: list[LeaderboardEntry]
    me: LeaderboardEntry | None = None  # posisi pemohon (bila di luar jendela)
    total: int  # jumlah pengguna aktif berpoin (denominator papan)
