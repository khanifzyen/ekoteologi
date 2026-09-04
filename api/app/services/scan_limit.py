"""Rate limit scan per user per hari (Sprint 2) + guard foto duplikat.

- Kuota harian (`SCAN_DAILY_LIMIT`, default 20) adalah turunan keputusan §2.1 #2
  (budget LLM) — nilainya via env agar PO bisa menyetel ulang tanpa deploy.
- **Fail-closed** bila Redis tidak dapat dihubungi (429/503): pelindung budget
  lebih penting daripada ketersediaan di sini — setiap scan yang lolos tanpa
  batas = biaya provider nyata. Ini kebalikan keputusan rate limit login
  (fail-open, Sprint 1) dan dicatat eksplisit; direvisi bersama hardening
  Sprint 8 bila PO memutuskan lain.
- Guard duplikat: foto byte-identikal dari user yang sama pada hari yang sama
  tetap dianalisis (hasil dari cache) tetapi bernilai poin 0 — mitigasi
  poin-farming (PRD §9).
"""

import logging
from datetime import datetime, timedelta
from datetime import time as dt_time
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = logging.getLogger("ekoteologi.scan")


class RateLimitedError(Exception):
    """Kuota scan harian user habis."""

    def __init__(self, message: str, retry_after_seconds: int = 0):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class ScanUnavailableError(Exception):
    """Redis tidak dapat dihubungi → fail-closed (pelindung budget LLM)."""


def _limit_key(user_id: UUID) -> str:
    return f"scan:limit:{get_settings().environment}:{user_id}:{_today()}"


def _dup_key(user_id: UUID, digest: str) -> str:
    return f"scan:dup:{get_settings().environment}:{user_id}:{_today()}:{digest}"


def _today() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d")


def _seconds_until_midnight() -> int:
    now = datetime.now().astimezone()
    tomorrow = datetime.combine(now.date() + timedelta(days=1), dt_time.min).astimezone()
    return max(60, int((tomorrow - now).total_seconds()))


def seconds_until_reset() -> int:
    """Detik hingga kuota harian reset (tengah malam waktu lokal)."""
    return _seconds_until_midnight()


async def peek_quota(redis: Redis, user_id: UUID) -> tuple[int, int] | None:
    """Baca kuota terpakai TANPA mengkonsumsi (GET, bukan INCR).

    Kembalikan `(used, limit)`; `None` bila Redis tidak dapat dihubungi —
    pemanggil menentukan degrade-nya (endpoint kuota → 503, UI menyembunyikan
    pill kuota). Kontras dgn `consume_scan_quota` yang fail-closed mutlak.
    """
    try:
        raw = await redis.get(_limit_key(user_id))
    except RedisError:
        logger.warning("Redis tidak tersedia — info kuota scan tidak dapat dibaca.")
        return None
    return int(raw or 0), get_settings().scan_daily_limit


async def consume_scan_quota(redis: Redis, user_id: UUID) -> int:
    """Pakai satu slot kuota harian; kembalikan sisa kuota setelahnya.

    Melempar `RateLimitedError` bila kuota habis, `ScanUnavailableError` bila
    Redis mati (fail-closed). Dipanggil setelah validasi gambar agar upload
    rusak tidak memakan kuota.
    """
    settings = get_settings()
    key = _limit_key(user_id)
    try:
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _seconds_until_midnight())
    except RedisError:
        logger.warning("Redis tidak tersedia — rate limit scan fail-CLOSED (scan ditolak).")
        raise ScanUnavailableError(
            "Layanan scan sedang tidak tersedia. Coba beberapa saat lagi."
        ) from None
    if count > settings.scan_daily_limit:
        raise RateLimitedError(
            f"Kuota scan harian habis (maksimal {settings.scan_daily_limit} kali per hari). "
            "Coba lagi besok.",
            retry_after_seconds=_seconds_until_midnight(),
        )
    return max(0, settings.scan_daily_limit - count)


async def register_scan_fingerprint(redis: Redis, user_id: UUID, digest: str) -> bool:
    """Tandai foto user utk hari ini; kembalikan True bila foto ini DUPLIKAT.

    Duplikat = hash byte sama dari user sama di hari sama (poin 0).
    """
    key = _dup_key(user_id, digest)
    try:
        if not await redis.set(key, 1, ex=_seconds_until_midnight(), nx=True):
            return True
        return False
    except RedisError:
        logger.warning("Redis tidak tersedia — guard foto duplikat dilewati.")
        return False
