"""Streak reminder (Sprint 8) — notifikasi "streak berisiko putus".

Story plan: "Notif event: streak reminder … (FCM + `notifications`)". Target
jujur dan berbasis data yang ada: user **aktif kemarin, belum aktif hari
ini, streak ≥ 2** — kalau hari ini diam, streaknya putus besok (reset lazy
Sprint 5). Pesan memakai angka streak asli user (mikrokonteks gaya mockup
"Sekali lagi untuk lanjut ke bonus…").

Tanpa infrastruktur cron: fungsi `run_streak_reminders()` **idempoten per
hari** lewat `app_settings` (kunci `streak_reminder_last_run`) sehingga aman
dipanggil (a) scheduler in-process (`services.scheduler`, nyala di
lifespan) dan (b) endpoint admin (`POST /v1/admin/notifications/streak-
reminder`) untuk ops/demo. Notifikasi in-app dibuat dalam SATU transaksi;
push dikirim best-effort setelah commit (pola Sprint 6).
"""

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting, Notification, User
from app.services.push import PushSender, push_notification
from app.services.streak import days_until_bonus

logger = logging.getLogger("ekoteologi.streak")

SETTING_KEY = "streak_reminder_last_run"
# Streak 0–1 belum layak diingatkan (belum "berisiko" — cukup satu hari
# bolong untuk reset; reminder bermakna mulai streak 2).
MIN_STREAK = 2


def reminder_body(streak: int, *, bonus_every_days: int) -> str:
    """Body notifikasi reminder (murni, teruji) — angka dari server."""
    if bonus_every_days > 0:
        to_bonus = days_until_bonus(streak, bonus_every_days)
        return (
            f"Streak {streak} hari-mu bisa putus hari ini. Lakukan satu aksi "
            f"hari ini — {to_bonus} hari lagi kamu dapat bonus!"
        )
    return f"Streak {streak} hari-mu bisa putus hari ini. Lakukan satu aksi agar tidak terputus!"


def reminder_title(streak: int) -> str:
    """Judul singkat reminder (murni, teruji)."""
    return f"Jaga streak {streak} hari-mu!"


def is_due(*, today: date, last_run: date | None, after_hour: int, now_hour: int) -> bool:
    """Jatuhkan jadwal (murni, teruji): sekali per hari, setelah jam tertentu."""
    if last_run == today:
        return False
    return now_hour >= after_hour


@dataclass(frozen=True)
class ReminderRun:
    """Rekap satu eksekusi reminder — masuk respons admin + log."""

    date: date
    targets: int  # notifikasi dibuat
    sent: int  # push sukses (mode log selalu sukses)
    skipped: bool  # sudah jalan hari ini


async def _last_run_date(db: AsyncSession) -> date | None:
    row = await db.get(AppSetting, SETTING_KEY)
    if row is None or not isinstance(row.value, dict):
        return None
    raw = row.value.get("date")
    if isinstance(raw, str):
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None
    return None


async def _set_last_run(db: AsyncSession, day: date) -> None:
    row = await db.get(AppSetting, SETTING_KEY)
    if row is None:
        row = AppSetting(key=SETTING_KEY, value={"date": day.isoformat()})
        db.add(row)
    else:
        row.value = {"date": day.isoformat()}


async def reminder_targets(db: AsyncSession, *, today: date, limit: int = 2000) -> list[User]:
    """User penerima reminder hari ini (aktif kemarin, belum aktif hari ini)."""
    yesterday = today - timedelta(days=1)
    rows = (
        await db.scalars(
            select(User)
            .where(
                User.is_active.is_(True),
                User.current_streak >= MIN_STREAK,
                User.last_active_date == yesterday,  # otomatis ≠ hari ini
            )
            .order_by(User.id)
            .limit(limit)
        )
    ).all()
    return list(rows)


async def run_streak_reminders(
    db: AsyncSession,
    *,
    now: datetime | None = None,
    sender: PushSender | None = None,
    force: bool = False,
) -> ReminderRun:
    """Jalankan pengiriman streak reminder (idempoten per hari).

    `force=True` (endpoint admin) memaksa kirim ulang — untuk demo/ops;
    default menghormati penanda harian di `app_settings`.
    """
    from app.core.config import get_settings

    settings = get_settings()
    moment = now or datetime.now().astimezone()
    today = moment.date()

    last_run = await _last_run_date(db)
    if not force and not is_due(
        today=today,
        last_run=last_run,
        after_hour=settings.streak_reminder_hour,
        now_hour=moment.hour,
    ):
        return ReminderRun(date=today, targets=0, sent=0, skipped=True)

    users = await reminder_targets(db, today=today)
    bonus_every = settings.streak_bonus_every_days
    notifications: list[Notification] = []
    for user in users:
        notif = Notification(
            user_id=user.id,
            title=reminder_title(user.current_streak),
            body=reminder_body(user.current_streak, bonus_every_days=bonus_every),
            type="streak",
            payload={"kind": "reminder", "streak": user.current_streak},
        )
        db.add(notif)
        notifications.append(notif)
    await _set_last_run(db, today)
    await db.commit()

    sent = 0
    for notif in notifications:  # push best-effort SETELAH commit
        sent += await push_notification(db, notif, sender=sender)

    logger.info("STREAK REMINDER %s: %d notifikasi, %d push", today, len(notifications), sent)
    return ReminderRun(date=today, targets=len(notifications), sent=sent, skipped=False)


def scheduler_should_run(*, enabled: bool, now_hour: int, after_hour: int) -> bool:
    """Gerbang ringan scheduler in-process (murni, teruji)."""
    return enabled and now_hour >= after_hour
