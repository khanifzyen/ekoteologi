"""Scheduler in-process (Sprint 8) — tugas terjadwal ringan tanpa cron.

Story plan Sprint 8 butuh "streak reminder" terjadwal; infrastruktur cron/
worker terpisah tidak tersedia di MVP (hosting pun masih item terbuka —
plan §2.2). Pendekatan: satu task asyncio yang dinyalakan di **lifespan**
FastAPI, bangun tiap `scheduler_interval_minutes`, dan menjalankan tugas
yang **idempoten per hari** — `run_streak_reminders()` memeriksa penanda
harian di `app_settings`, jadi memanggilnya berulang (restart, beberapa
pekerja) tidak menggandakan notifikasi.

Trade-off yang disengaja (dokumentasi laporan Sprint 8): scheduler hidup di
dalam proses API — cukup utk MVP single-worker; bila nanti API di-scale
multi-worker, tugasnya tetap aman (idempoten) dan bisa dipindah ke cron
eksternal (`POST /v1/admin/notifications/streak-reminder`) tanpa perubahan
logika.
"""

import asyncio
import contextlib
import logging
from datetime import datetime

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.services.streak_reminder import run_streak_reminders, scheduler_should_run

logger = logging.getLogger("ekoteologi.scheduler")

_task: asyncio.Task | None = None


async def _loop() -> None:
    settings = get_settings()
    interval = max(1, settings.scheduler_interval_minutes) * 60
    while True:
        try:
            await asyncio.sleep(interval)
            moment = datetime.now().astimezone()
            if not scheduler_should_run(
                enabled=settings.streak_reminder_enabled,
                now_hour=moment.hour,
                after_hour=settings.streak_reminder_hour,
            ):
                continue
            async with get_session_factory()() as db:
                result = await run_streak_reminders(db, now=moment)
                if result.skipped:
                    logger.debug("Scheduler: streak reminder sudah jalan hari ini — dilewati.")
        except asyncio.CancelledError:  # pragma: no cover — shutdown
            raise
        except Exception:  # noqa: BLE001 — scheduler tidak boleh mati
            logger.warning("Scheduler gagal pada satu putaran — mencoba lagi.", exc_info=True)


def start_scheduler() -> bool:
    """Nyalakan task latar bila diaktifkan env. Return True bila menyala."""
    global _task
    settings = get_settings()
    if not settings.streak_reminder_enabled:
        logger.info("Scheduler mati (STREAK_REMINDER_ENABLED=false).")
        return False
    if _task is not None and not _task.done():
        return True
    _task = asyncio.create_task(_loop(), name="ekoteologi-scheduler")
    logger.info(
        "Scheduler nyala — streak reminder tiap %d menit setelah jam %02d:00.",
        settings.scheduler_interval_minutes,
        settings.streak_reminder_hour,
    )
    return True


async def stop_scheduler() -> None:
    """Matikan task latar (dipanggil saat shutdown aplikasi)."""
    global _task
    if _task is not None and not _task.done():
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _task
    _task = None
