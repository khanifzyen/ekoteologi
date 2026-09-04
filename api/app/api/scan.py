"""Scan AI endpoint (Sprint 2): `POST /v1/scan` — foto → LLM → JSON tervalidasi → tersimpan.

Alur (PRD §2.2/§4, implementation-plan Sprint 2):
1. validasi foto (ukuran + magic bytes, pola sama dgn avatar Sprint 1);
2. konsumsi kuota harian (rate limit per user, fail-closed — pelindung budget LLM);
3. cek cache Redis per hash foto → HIT: tanpa panggilan LLM (biaya nol, instan);
4. MISS: panggil provider LLM (retry + fallback + timeout) → validasi schema Pydantic;
5. quote diambil dari bank terkurasi per kategori (anti-halusinasi, PRD §9);
6. simpan `scans` lengkap dgn `llm_raw` + `llm_meta` (PRD §5.3) dan foto ke `UPLOAD_DIR`;
7. poin via ledger append-only + sinkron cache `users.points` (PRD §5.10 #1);
   foto duplikat (hash sama, user sama, hari sama) bernilai poin 0 (PRD §9).
"""

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_db, get_redis_dep
from app.models import Scan, User, WasteCategory
from app.schemas.scan import Quote, ScanCategoryOut, ScanResponse
from app.services import scan_cache, scan_limit
from app.services.ledger import award_points
from app.services.llm import LLMError, get_llm_provider
from app.services.quotes import quote_for_category

logger = logging.getLogger("ekoteologi.scan")

router = APIRouter(prefix="/v1/scan", tags=["scan"])

# Magic bytes lebih dipercaya daripada Content-Type header klien (pola avatar).
_IMAGE_SIGNATURES: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
}
_WEBP = ("image/webp", "webp")


def _detect_mime(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return _WEBP[0]
    return None


def _save_image(data: bytes, mime: str) -> str:
    """Simpan foto scan ke UPLOAD_DIR/scans; kembalikan URL relatif `/uploads/scans/…`."""
    ext = _IMAGE_SIGNATURES.get(mime) or (_WEBP[1] if mime == _WEBP[0] else "bin")
    scan_dir = Path(get_settings().upload_dir) / "scans"
    scan_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    (scan_dir / filename).write_bytes(data)
    return f"/uploads/scans/{filename}"


async def _category_names(db: AsyncSession) -> list[str]:
    return list((await db.scalars(select(WasteCategory.name))).all())


@router.post("", response_model=ScanResponse)
async def create_scan(
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis_dep),
) -> ScanResponse:
    settings = get_settings()
    data = await file.read()

    if len(data) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Foto scan kosong.")
    max_bytes = settings.scan_image_max_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"Ukuran foto maksimal {settings.scan_image_max_mb} MB.",
        )
    mime = _detect_mime(data)
    if mime is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Format foto harus JPG, PNG, atau WebP.")

    digest = scan_cache.image_digest(data)

    # Kuota harian dikonsumsi setelah foto valid agar upload rusak tidak memakan kuota.
    try:
        await scan_limit.consume_scan_quota(redis, user.id)
    except scan_limit.RateLimitedError as exc:
        headers = {}
        if exc.retry_after_seconds:
            headers["Retry-After"] = str(exc.retry_after_seconds)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc), headers=headers) from None
    except scan_limit.ScanUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None

    cached_payload = await scan_cache.get_cached(redis, digest)
    cached = cached_payload is not None
    if cached:
        logger.info("SCAN cache HIT digest=%s user=%s", digest[:12], user.id)
        llm_raw = cached_payload.get("llm_raw")
        llm_meta = dict(cached_payload.get("llm_meta") or {})
        llm_meta["cached"] = True
        item_name = str(cached_payload["item_name"])
        category_name = str(cached_payload["category"])
        advice = str(cached_payload["advice"])
        llm_points = int(cached_payload["points"])
    else:
        logger.info(
            "SCAN cache MISS digest=%s — memanggil LLM (mode=%s)", digest[:12], settings.llm_mode
        )
        try:
            response = await get_llm_provider().analyze(data, mime, await _category_names(db))
        except LLMError as exc:
            logger.warning("SCAN gagal: LLM tidak merespons valid — %s", exc)
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "Layanan analisis sedang gangguan. Silakan coba lagi beberapa saat.",
            ) from None
        llm_raw = response.raw
        llm_meta = {**response.meta, "cached": False}
        item_name = response.result.item_name
        category_name = response.result.category
        advice = response.result.advice
        llm_points = response.result.points

        # Simpan hasil ke cache agar foto yang sama tidak memanggil LLM lagi
        # (instan + biaya nol — PRD §5.10 #6). Meta disimpan apa adanya; penanda
        # `cached` ditambahkan saat retrieval.
        await scan_cache.store_cached(
            redis,
            digest,
            {
                "item_name": item_name,
                "category": category_name,
                "advice": advice,
                "points": llm_points,
                "llm_raw": llm_raw,
                "llm_meta": response.meta,
            },
        )

    category = (
        await db.scalars(
            select(WasteCategory).where(func.lower(WasteCategory.name) == category_name.casefold())
        )
    ).first()
    if category is None:  # seharusnya tak terjadi — nama tervalidasi thd daftar DB
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Kategori hasil analisis tidak dikenali.")

    quote: Quote = quote_for_category(category.name)

    duplicate = await scan_limit.register_scan_fingerprint(redis, user.id, digest)
    points = 0 if duplicate else min(llm_points, category.base_points)

    scan = Scan(
        user_id=user.id,
        image_url=_save_image(data, mime),
        item_name=item_name[:100],
        category_id=category.id,
        advice=advice,
        quote=quote.model_dump(),
        llm_raw=llm_raw,
        llm_meta=llm_meta,
        points=points,
    )
    db.add(scan)
    await db.flush()  # dapatkan scan.id utk ref_id ledger

    if points > 0:
        await award_points(
            db, user=user, amount=points, source="scan", ref_id=scan.id, note=f"Scan: {item_name}"
        )
    await db.commit()
    await db.refresh(scan)

    logger.info(
        "SCAN OK id=%s user=%s item='%s' category=%s points=%d cached=%s duplicate=%s",
        scan.id,
        user.id,
        item_name,
        category.name,
        points,
        cached,
        duplicate,
    )
    return ScanResponse(
        id=scan.id,
        item_name=scan.item_name,
        category=ScanCategoryOut.model_validate(category, from_attributes=True),
        advice=scan.advice,
        quote=quote,
        points=points,
        points_total=user.points,
        cached=cached,
        duplicate=duplicate,
        image_url=scan.image_url,
        created_at=scan.created_at,
    )
