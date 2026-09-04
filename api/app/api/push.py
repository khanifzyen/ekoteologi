"""Push FCM: simpan/hapus token perangkat (Sprint 6) — tabel `fcm_tokens`.

- `POST   /v1/push/token`  — daftarkan token (upsert idempoten; token yang
  sudah dipakai akun lain berpindah ke akun ini — perangkat sama, ganti akun).
- `DELETE /v1/push/token`  — hapus token (logout / token dicabut Google).

Pengiriman pesan: `services/push.py` (abstraksi `PushSender`; mode default
`log` karena kredensial FCM server masih item terbuka). Notifikasi in-app
(`notifications`) adalah sumber push — `push_notification()` mem-pipe baris
notifikasi ke pengirim aktif.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models import User
from app.services.push import register_token, remove_token

logger = logging.getLogger("ekoteologi.push")

router = APIRouter(prefix="/v1/push", tags=["push"])

MIN_TOKEN_LEN = 32  # token FCM nyata ±140–180 karakter; cutoff ketat anti sampah


class PushTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=4096)
    platform: str | None = Field(default=None, max_length=20)  # android|ios|web (informatif)


class PushTokenResponse(BaseModel):
    registered: bool
    message: str


@router.post("/token", response_model=PushTokenResponse, status_code=200)
async def register_push_token(
    payload: PushTokenRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PushTokenResponse:
    """Simpan token FCM perangkat (idempoten — panggilan ulang aman)."""
    token = payload.token.strip()
    if len(token) < MIN_TOKEN_LEN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Token FCM tidak valid (terlalu pendek).",
        )
    if payload.platform is not None and payload.platform.strip():
        logger.info("PUSH token platform=%s user=%s", payload.platform.strip(), user.id)

    await register_token(db, user_id=user.id, token=token)
    await db.commit()
    logger.info("PUSH token registered user=%s token=%s…", user.id, token[:12])
    return PushTokenResponse(registered=True, message="Token notifikasi terdaftar.")


@router.delete("/token", response_model=PushTokenResponse)
async def delete_push_token(
    payload: PushTokenRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PushTokenResponse:
    """Hapus token milik sendiri (idempoten — token asing/ tak dikenal → 200)."""
    token = payload.token.strip()
    removed = await remove_token(db, user_id=user.id, token=token)
    if removed:
        await db.commit()
        logger.info("PUSH token removed user=%s token=%s…", user.id, token[:12])
    return PushTokenResponse(
        registered=False,
        message="Token notifikasi dihapus." if removed else "Token tidak ditemukan.",
    )
