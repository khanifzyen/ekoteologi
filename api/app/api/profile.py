"""Profil user (Sprint 1): lihat, ubah nama/kota/avatar, unggah avatar.

Avatar disimpan di `UPLOAD_DIR` (default `var/uploads`) dan dilayani statis di
`/uploads`. Di produksi direktori ini harus di-mount sebagai volume.
"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_current_user, get_db
from app.models import Level, User
from app.schemas.profile import ProfileResponse, ProfileUpdate

router = APIRouter(prefix="/v1/profile", tags=["profile"])

# Magic bytes lebih dipercaya daripada Content-Type header dari klien.
_IMAGE_SIGNATURES: dict[str, bytes] = {
    "jpg": b"\xff\xd8\xff",
    "png": b"\x89PNG\r\n\x1a\n",
}
_WEBP_PREFIX = b"RIFF"
_WEBP_MARKER = b"WEBP"


def _level_for(points: int, level_row: Level | None) -> tuple[int, str]:
    if level_row is None:
        return 1, "Pemula"
    return level_row.level, level_row.title


async def _highest_level(db: AsyncSession, points: int) -> Level | None:
    return (
        await db.scalars(
            select(Level)
            .where(Level.min_points <= points)
            .order_by(Level.min_points.desc())
            .limit(1)
        )
    ).first()


def _to_response(user: User, level_row: Level | None) -> ProfileResponse:
    level, title = _level_for(user.points, level_row)
    return ProfileResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        avatar_url=user.avatar_url,
        city=user.city,
        points=user.points,
        level=level,
        level_title=title,
    )


@router.get("", response_model=ProfileResponse)
async def get_profile(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> ProfileResponse:
    return _to_response(user, await _highest_level(db, user.points))


@router.patch("", response_model=ProfileResponse)
async def update_profile(
    payload: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileResponse:
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.city is not None:
        user.city = payload.city.strip() or None
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url or None
    await db.commit()
    await db.refresh(user)
    return _to_response(user, await _highest_level(db, user.points))


def _detect_ext(data: bytes) -> str | None:
    for ext, sig in _IMAGE_SIGNATURES.items():
        if data.startswith(sig):
            return ext
    if data[:4] == _WEBP_PREFIX and data[8:12] == _WEBP_MARKER:
        return "webp"
    return None


@router.post("/avatar", response_model=ProfileResponse)
async def upload_avatar(
    file: UploadFile,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileResponse:
    settings = get_settings()
    max_bytes = settings.avatar_max_mb * 1024 * 1024
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Berkas avatar kosong.")
    if len(data) > max_bytes:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"Ukuran avatar maksimal {settings.avatar_max_mb} MB.",
        )
    ext = _detect_ext(data)
    if ext is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Format avatar harus JPG, PNG, atau WebP.",
        )

    avatar_dir = Path(settings.upload_dir) / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    (avatar_dir / filename).write_bytes(data)

    # Hapus avatar lama bila disimpan di direktori yang sama (bukan URL eksternal).
    if user.avatar_url and user.avatar_url.startswith("/uploads/avatars/"):
        old = Path(settings.upload_dir) / "avatars" / Path(user.avatar_url).name
        old.unlink(missing_ok=True)

    user.avatar_url = f"/uploads/avatars/{filename}"
    await db.commit()
    await db.refresh(user)
    return _to_response(user, await _highest_level(db, user.points))
