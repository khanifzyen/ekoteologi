"""Streak harian (Sprint 5) — PRD §2.5/§5.1: `current_streak`, `longest_streak`,
`last_active_date` pada `users`.

Aturan (keputusan kerja terdokumentasi — detail bonus longgar di PRD):
- Aktivitas yang menandai hari: scan bernilai poin (>0, bukan duplikat),
  klaim misi manual, dan misi photo yang disetujui verifier — semuanya
  menulis ledger, jadi kalender streak bisa dibangun dari `point_transactions`.
- `touch_streak` idempoten per hari: aktivitas kedua di hari sama tidak
  menaikkan streak & tidak menggandakan bonus.
- Bolong (terakhir aktif ≠ kemarin/hari ini) → streak kembali ke 1 saat aktif
  lagi (reset lazy — tidak ada cron; tampilan menunjukkan streak efektif 0).
- Bonus +`streak_bonus_points` (default 20) setiap kelipatan
  `streak_bonus_every_days` (default 6 — mockup `beranda.html`: "Streak 5
  hari! … 1 hari lagi untuk bonus +20 poin" ⇒ bonus jatuh di hari ke-6).
  Keduanya env, 0 = bonus dimatikan. Bonus lewat ledger `source="streak"`
  (PRD §5.2) + notifikasi in-app + event `streak_hari` (PRD §8).
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Notification, PointTransaction, User
from app.services.ledger import award_points
from app.services.metrics import EVENT_STREAK_HARI, track_event


def next_streak(*, current: int, last_active_date: date | None, today: date) -> int:
    """Streak berikutnya saat user aktif di `today` (fungsi murni, teruji).

    - Belum pernah aktif → 1.
    - Terakhir aktif hari ini → tidak berubah (idempoten).
    - Terakhir aktif kemarin → +1 (streak berlanjut).
    - Ada celah → reset ke 1.
    """
    if last_active_date is None:
        return 1
    if last_active_date == today:
        return max(1, current)
    if last_active_date == today - timedelta(days=1):
        return current + 1
    return 1


def effective_streak(*, current: int, last_active_date: date | None, today: date) -> int:
    """Streak yang layak ditampilkan hari ini TANPA aktivitas baru.

    Streak tetap dipajang bila terakhir aktif kemarin (masih bisa dilanjutkan
    hari ini); bila sudah bolong ≥2 hari, tampil 0 (jujur — putus).
    """
    if last_active_date is None:
        return 0
    if last_active_date == today:
        return current
    if last_active_date == today - timedelta(days=1):
        return current
    return 0


def days_until_bonus(current: int, every_days: int) -> int:
    """Hari tersampai bonus berikutnya (fungsi murni, teruji).

    `current` = streak efektif hari ini. Mis. every=6: current 5 → 1
    (cocok dgn mockup "1 hari lagi untuk bonus +20 poin"); current 6 → 6
    (bonus hari ke-6 baru saja/akan diraih, berikutnya di hari ke-12).
    """
    if every_days <= 0:
        return 0
    remainder = current % every_days
    return every_days - remainder if remainder != 0 else every_days


@dataclass(frozen=True)
class StreakTouchResult:
    """Hasil satu `touch_streak` — utk log & respons pemanggil."""

    streak: int
    bonus_awarded: int
    incremented: bool  # False = sudah aktif hari ini (idempoten)


async def touch_streak(
    db: AsyncSession, *, user: User, now: datetime | None = None
) -> StreakTouchResult:
    """Tandai user aktif hari ini: update streak (+longest), beri bonus bila
    kelipatan tercapai, notifikasi in-app, dan event `streak_hari` (PRD §8).

    Tidak melakukan commit — ikut transaksi pemanggil (scan/klaim/approve)
    agar poin, notifikasi, dan event konsisten atomik.
    """
    moment = now or datetime.now().astimezone()
    today = moment.date()
    settings = get_settings()

    if user.last_active_date == today:
        return StreakTouchResult(streak=user.current_streak, bonus_awarded=0, incremented=False)

    streak = next_streak(
        current=user.current_streak, last_active_date=user.last_active_date, today=today
    )
    user.current_streak = streak
    user.longest_streak = max(user.longest_streak or 0, streak)
    user.last_active_date = today

    bonus = 0
    every = settings.streak_bonus_every_days
    if every > 0 and settings.streak_bonus_points > 0 and streak % every == 0:
        bonus = settings.streak_bonus_points
        await award_points(
            db,
            user=user,
            amount=bonus,
            source="streak",
            note=f"Bonus streak {streak} hari berturut-turut",
        )
        db.add(
            Notification(
                user_id=user.id,
                title=f"Bonus streak {streak} hari!",
                body=f"Konsistensimu terjaga {streak} hari — bonus +{bonus} poin masuk ke akunmu.",
                type="streak",
                payload={"streak": streak, "points": bonus},
            )
        )

    await track_event(
        db,
        user_id=user.id,
        name=EVENT_STREAK_HARI,
        payload={"streak": streak, "bonus": bonus},
    )
    return StreakTouchResult(streak=streak, bonus_awarded=bonus, incremented=True)


async def active_dates_from_ledger(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    since: date,
    until: date | None = None,
) -> set[date]:
    """Tanggal-tanggal aktif (ada baris ledger) dalam jendela `[since, until]`.

    Semua aktivitas bernilai (scan, misi, bonus streak) menulis ledger, jadi
    ini adalah sumber kalender 7 hari di kartu streak `beranda.html`. Tanggal
    dihitung di aplikasi (`astimezone` lokal server) — konsisten dgn keputusan
    bucket tanggal Sprint 4 (jangan `date()` di sisi Postgres).
    """
    start = datetime.combine(since, time.min).astimezone()
    end_exclusive = datetime.combine(
        (until or date.today()) + timedelta(days=1), time.min
    ).astimezone()
    rows = await db.scalars(
        select(PointTransaction.created_at).where(
            PointTransaction.user_id == user_id,
            PointTransaction.created_at >= start,
            PointTransaction.created_at < end_exclusive,
        )
    )
    return {row.astimezone().date() for row in rows}


def build_week(today: date, active_dates: set[date], days: int = 7) -> list[dict[str, Any]]:
    """Kalender `days` hari berakhir hari ini (fungsi murni, teruji).

    Urutan lama → baru; elemen terakhir selalu hari ini (outline di UI).
    """
    return [
        {
            "date": today - timedelta(days=days - 1 - offset),
            "active": (today - timedelta(days=days - 1 - offset)) in active_dates,
        }
        for offset in range(days)
    ]
