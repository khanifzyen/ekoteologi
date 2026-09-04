"""Rate limit login per email+IP di Redis (Sprint 1).

Fail-open: bila Redis tidak dapat dihubungi, percobaan login tetap diterima
(dengan warning log) — ketersediaan login lebih diprioritaskan daripada
pembatasan; hardening rate limit global ada di Sprint 8.
"""

import logging

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_PREFIX = "login-fail"


def _key(email: str, ip: str) -> str:
    return f"{_prefix()}:{email.lower()}:{ip}"


def _prefix() -> str:
    # Namespace per lingkungan agar test/dev tidak saling mengganggu.
    env = get_settings().environment
    return f"{_PREFIX}:{env}"


async def check_login_allowed(redis: Redis, email: str, ip: str) -> tuple[bool, int]:
    """Kembalikan (boleh_login, detik_tunggu). Selalu boleh bila Redis gagal."""
    settings = get_settings()
    try:
        ttl = await redis.ttl(_key(email, ip))
    except RedisError:
        logger.warning("Redis tidak tersedia — rate limit login dilewati (fail-open).")
        return True, 0
    if ttl is None or ttl <= 0:
        return True, 0
    # Kunci masih ada = window belum habis sejak gagal terakhir; blok bila kuota penuh.
    try:
        count = await redis.get(_key(email, ip))
    except RedisError:
        return True, 0
    if count is not None and int(count) >= settings.login_max_attempts:
        return False, ttl
    return True, 0


async def register_login_failure(redis: Redis, email: str, ip: str) -> None:
    settings = get_settings()
    try:
        key = _key(email, ip)
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, settings.login_window_minutes * 60)
    except RedisError:
        logger.warning("Redis tidak tersedia — kegagalan login tidak dicatat.")


async def reset_login_failures(redis: Redis, email: str, ip: str) -> None:
    try:
        await redis.delete(_key(email, ip))
    except RedisError:
        logger.warning("Redis tidak tersedia — reset rate limit dilewati.")
