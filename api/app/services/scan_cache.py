"""Cache hasil analisis scan di Redis (Sprint 2) — PRD §2.2/§5.10 #6.

Kunci cache = hash konten foto (SHA-256): hasil analisis "per jenis item" dalam
praktiknya dipetakan deterministik dari isi foto, sehingga foto yang sama tidak
pernah memanggil LLM dua kali (respons instan + biaya nol). Nilai = hasil
tervalidasi + meta — tanpa bagian milik user tertentu (poin dihitung per-request).

Tersedia juga penghitung hit/miss per lingkungan (`scan:stats:*`) sebagai dasar
metrik cache hit rate ≥70% (PRD §8) yang ditampilkan dashboard admin Sprint 4.

Cache bersifat best-effort: bila Redis gagal, scan tetap jalan (cache miss);
berbeda dgn rate limit harian yang fail-closed (pelindung budget LLM).
"""

import hashlib
import json
import logging
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings

logger = logging.getLogger("ekoteologi.scan")


def image_digest(image: bytes) -> str:
    return hashlib.sha256(image).hexdigest()


def _cache_key(digest: str) -> str:
    settings = get_settings()
    return f"scan:cache:{settings.environment}:{settings.scan_cache_schema}:{digest}"


def _stats_key(kind: str) -> str:
    return f"scan:stats:{get_settings().environment}:{kind}"


async def get_cached(redis: Redis, digest: str) -> dict[str, Any] | None:
    """Ambil hasil cache; None bila miss / Redis gagal (fail-open)."""
    try:
        raw = await redis.get(_cache_key(digest))
        if raw is None:
            await redis.incr(_stats_key("miss"))
            return None
        await redis.incr(_stats_key("hit"))
        payload = json.loads(raw)
        return payload if isinstance(payload, dict) else None
    except RedisError:
        logger.warning("Redis tidak tersedia — cache scan dilewati (fail-open).")
        return None
    except json.JSONDecodeError:
        logger.warning("Entri cache scan rusak — diperlakukan sebagai miss.")
        return None


async def store_cached(redis: Redis, digest: str, payload: dict[str, Any]) -> None:
    """Simpan hasil analisis ke cache (best-effort; TTL dari env)."""
    settings = get_settings()
    try:
        await redis.set(
            _cache_key(digest),
            json.dumps(payload, ensure_ascii=False),
            ex=settings.scan_cache_ttl_hours * 3600,
        )
    except RedisError:
        logger.warning("Redis tidak tersedia — hasil scan tidak dicache.")


async def cache_stats(redis: Redis) -> dict[str, int]:
    """Baca penghitung hit/miss (untuk dashboard; dipakai test Sprint 2)."""
    try:
        hits = int(await redis.get(_stats_key("hit")) or 0)
        misses = int(await redis.get(_stats_key("miss")) or 0)
    except RedisError:
        return {"hit": 0, "miss": 0}
    return {"hit": hits, "miss": misses}
