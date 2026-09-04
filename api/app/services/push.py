"""Push notification (Sprint 6) — infrastruktur token FCM + abstraksi pengirim.

Rencana Sprint 6 = "FCM setup + simpan token": **kredensial FCM asli belum
tersedia** di lingkungan ini (butuh akun Google Cloud + service account —
prasyarat plan §2.2 yang masih terbuka sejak Sprint 0), jadi yang dibangun:

1. **Simpan token**: endpoint `POST/DELETE /v1/push/token` mengelola baris
   `fcm_tokens` (skema PRD §5.1, `token` UNIQUE — upsert idempoten).
2. **Abstraksi pengirim**: `PushSender` (protocol) dengan dua implementasi —
   `LogPushSender` (default dev/test: push dicatat di log, mudah diverifikasi
   tanpa kredensial) dan `FcmHttpV1Sender` (siap kirim via FCM HTTP v1 API;
   aktif hanya bila `push_mode=fcm` DAN file kredensial service account
   tersedia — item terbuka, lihat laporan sprint).
3. **Pintu kirim**: `push_notification()` mengambil token milik satu user dan
   menyerahkannya ke pengirim aktif — best-effort (gagal push tidak pernah
   menggagalkan request yang sudah sukses). Dipanggil setelah commit di
   endpoint yang membuat notifikasi in-app (sumber push — keputusan Sprint 5).

Saat kredensial tersedia (Sprint 8 — composer push): set `PUSH_MODE=fcm`,
pasang `FCM_CREDENTIALS_FILE` (JSON service account dengan permission
`https://www.googleapis.com/auth/firebase.messaging`), dan lengkapi
`FcmHttpV1Sender._send_one` dengan HTTP client OAuth — struktur datanya
(token per user) sudah siap tanpa migrasi lagi.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import FcmToken, Notification

logger = logging.getLogger("ekoteologi.push")

PUSH_MODES = ("log", "fcm")


class PushSender(Protocol):
    """Kontrak pengirim push — implementasi wajib idempoten & non-blocking."""

    async def send(self, *, token: str, title: str, body: str, data: dict[str, Any]) -> bool:
        """Kirim satu pesan ke satu token. False = gagal (token mungkin mati)."""
        ...


class LogPushSender:
    """Pengirim mode dev/test: pesan dicatat, tidak ada jaringan.

    Berguna (a) membuktikan alur notification→push di log tanpa kredensial,
    (b) sebagai fallback aman bila kredensial belum dipasang di staging.
    """

    async def send(self, *, token: str, title: str, body: str, data: dict[str, Any]) -> bool:
        logger.info(
            "PUSH (mode=log) token=%s… title='%s' body='%s' data=%s",
            token[:12],
            title,
            body,
            data,
        )
        return True


class FcmHttpV1Sender:
    """Pengirim FCM HTTP v1 (OAuth2 service account) — butuh kredensial server.

    Kerangka sudah mengikuti kontrak API FCM v1 (`projects/{id}/messages:send`).
    Implementasi lengkapnya menunggu kredensial (item terbuka Sprint 6); tanpa
    kredensial factory tidak akan pernah memilih mode ini (fail-safe ke log).
    """

    FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

    def __init__(self, credentials_file: str, project_id: str) -> None:
        self.credentials_file = credentials_file
        self.project_id = project_id

    def _load_credentials(self) -> dict[str, Any]:
        """Baca JSON service account; lempar RuntimeError bila tidak layak."""
        path = Path(self.credentials_file)
        if not path.is_file():
            raise RuntimeError(f"File kredensial FCM tidak ditemukan: {path}")
        data = json.loads(path.read_text())
        for field in ("client_email", "private_key", "project_id"):
            if not data.get(field):
                raise RuntimeError(f"Kredensial FCM tidak lengkap: kolom '{field}' kosong.")
        return data

    async def _send_one(self, *, token: str, title: str, body: str, data: dict[str, Any]) -> bool:
        """Satu panggilan `projects/{id}/messages:send` (butuh OAuth2 token)."""
        # Placeholder yang jujur: pengiriman nyata butuh JWT→OAuth2 access token
        # (signed dgn private_key service account). Dituntaskan bersama kredensial.
        raise RuntimeError(
            "Pengiriman FCM nyata butuh kredensial service account (item terbuka — "
            "lihat laporan Sprint 6). Mode 'log' tetap dipakai sampai kredensial dipasang."
        )

    async def send(self, *, token: str, title: str, body: str, data: dict[str, Any]) -> bool:
        creds = self._load_credentials()
        del creds  # dipakai _send_one versi lengkap (OAuth2)
        return await self._send_one(token=token, title=title, body=body, data=data)


def get_push_sender() -> PushSender:
    """Pilih pengirim dari env — `push_mode=fcm` tanpa kredensial layak → log.

    Validasi konfigurasi dilakukan DI SINI (fail-safe) supaya pemanggil tidak
    pernah tumbang hanya karena env salah; warning log menandai salah konfigurasi.
    """
    settings = get_settings()
    if settings.push_mode == "fcm":
        if settings.fcm_credentials_file and settings.fcm_project_id:
            return FcmHttpV1Sender(settings.fcm_credentials_file, settings.fcm_project_id)
        logger.warning(
            "PUSH_MODE=fcm tapi FCM_CREDENTIALS_FILE/FCM_PROJECT_ID belum lengkap — "
            "fallback ke mode log (push hanya dicatat)."
        )
    return LogPushSender()


async def register_token(db: AsyncSession, *, user_id: Any, token: str) -> FcmToken:
    """Upsert satu token FCM milik user (idempoten — token UNIQUE di DB).

    Token yang sudah ada milik user lain dipindahkan ke user ini (perangkat
    sama, akun diganti) — perilaku standar manajemen token FCM.
    """
    existing = (await db.scalars(select(FcmToken).where(FcmToken.token == token))).first()
    if existing is not None:
        existing.user_id = user_id
        return existing
    row = FcmToken(user_id=user_id, token=token)
    db.add(row)
    await db.flush()
    return row


async def remove_token(db: AsyncSession, *, user_id: Any, token: str) -> bool:
    """Hapus token (logout/uninstall). True bila baris milik user terhapus."""
    existing = (await db.scalars(select(FcmToken).where(FcmToken.token == token))).first()
    if existing is None or existing.user_id != user_id:
        return False
    await db.delete(existing)
    return True


async def push_notification(
    db: AsyncSession,
    notification: Notification,
    *,
    sender: PushSender | None = None,
) -> int:
    """Kirim satu notifikasi in-app sebagai push ke seluruh token user.

    Best-effort & non-blocking: error per token ditelan (dicatat), satu token
    gagal tidak menghentikan token lain. TIDAK melakukan commit/flush — data
    tetap milik transaksi pemanggil. Kembalikan jumlah terkirim sukses.
    """
    if notification.user_id is None:  # broadcast = domain composer Sprint 8
        return 0
    tokens = (
        await db.scalars(select(FcmToken.token).where(FcmToken.user_id == notification.user_id))
    ).all()
    if not tokens:
        return 0

    chosen = sender or get_push_sender()
    data: dict[str, Any] = {
        "notification_id": notification.id,
        "type": notification.type or "info",
        **(notification.payload or {}),
    }
    results = await asyncio.gather(
        *(
            chosen.send(
                token=token,
                title=notification.title or "",
                body=notification.body or "",
                data=data,
            )
            for token in tokens
        ),
        return_exceptions=True,
    )
    sent = 0
    for token, result in zip(tokens, results, strict=True):
        if isinstance(result, BaseException):
            logger.warning("PUSH gagal token=%s…: %s", token[:12], result)
        elif result:
            sent += 1
    return sent
