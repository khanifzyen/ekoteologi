"""Helper notifikasi in-app (Sprint 5) — tabel `notifications` (PRD §5.9).

Sprint ini: hasil verifikasi misi (approve/reject), misi auto_scan selesai,
dan bonus streak. Baris notifikasi ini adalah **sumber push FCM** (Sprint 6):
`services.push.push_notification()` mem-pipe baris ke pengirim aktif setelah
commit (mode default `log` sampai kredensial server dipasang).
"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification

# Nilai sah kolom `notifications.type` (PRD §5.9).
NOTIFICATION_TYPES = ("mission", "streak", "info", "reward")


def notify(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str,
    type_: str,
    payload: dict[str, Any] | None = None,
) -> Notification:
    """Tambah satu baris notifikasi ke sesi (tanpa commit — ikut transaksi pemanggil)."""
    notification = Notification(
        user_id=user_id, title=title, body=body, type=type_, payload=payload
    )
    db.add(notification)
    return notification
