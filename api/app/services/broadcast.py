"""Composer push broadcast (Sprint 8) — kirim notifikasi ke semua/segmen.

Story plan: "Admin: composer push (semua/segmen) — role admin saja; audit
log". Bentuk data mengikuti desain skema yang sudah ada sejak awal:
`notifications.user_id NULL = broadcast` (satu baris untuk semua penerima
— in-app list menampilkannya ke tiap user), sementara **push FCM** dikirim
langsung ke seluruh token milik user yang cocok dgn segmen.

Segmen didefinisikan dari data yang benar-benar ada di `users` (bukan
karangan): semua akun aktif, aktivitas 7 hari (dari `last_active_date` —
sumber yang sama dgn streak Sprint 5), dan kepemilikan token push
(`fcm_tokens`). Resolusi kriteria berupa **fungsi murni** (`segment_filters`)
sehingga mudah diuji; endpoint admin memakai fungsi yang sama untuk hitung
jumlah penerima (preview komposer) dan pengiriman (satu kebenaran).
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FcmToken, Notification, User
from app.services.push import PushSender

logger = logging.getLogger("ekoteologi.push")

# Segmen yang sah — kunci dikirim klien, label utk UI/konten respons.
SEGMENT_ALL = "all"
SEGMENT_ACTIVE_7D = "aktif_7hari"
SEGMENT_INACTIVE_7D = "pasif_7hari"
SEGMENT_WITH_TOKEN = "bertoken"
SEGMENTS: dict[str, str] = {
    SEGMENT_ALL: "Semua pengguna aktif",
    SEGMENT_ACTIVE_7D: "Aktif 7 hari terakhir",
    SEGMENT_INACTIVE_7D: "Pasif lebih dari 7 hari",
    SEGMENT_WITH_TOKEN: "Punya token push (FCM)",
}

# Kirim push dalam batch supaya broadcast besar tidak menahan memori
# (asyncio.gather atas ratusan ribu coroutine sekaligus = boros).
BROADCAST_BATCH = 500

ACTIVE_WINDOW_DAYS = 7


def _base_filters(segment: str, *, today: date | None = None) -> list[Any]:
    """Kriteria `users` tanpa filter token (fungsi murni, teruji).

    Semua segmen selalu menyertakan `is_active` — akun diblokir tidak pernah
    menerima notifikasi apa pun. Dipisah dari `segment_filters` supaya query
    yang SUDAH menggabungkan `fcm_tokens` (hitung token, kirim push) bisa
    memakai kriteria yang sama tanpa EXISTS ganda (auto-correlation).
    """
    day = today or date.today()
    cutoff = day - timedelta(days=ACTIVE_WINDOW_DAYS)
    filters: list[Any] = [User.is_active.is_(True)]
    if segment == SEGMENT_ACTIVE_7D:
        filters.append(User.last_active_date.is_not(None))
        filters.append(User.last_active_date >= cutoff)
    elif segment == SEGMENT_INACTIVE_7D:
        filters.append(User.last_active_date.is_(None) | (User.last_active_date < cutoff))
    return filters


def segment_filters(segment: str, *, today: date | None = None) -> list[Any]:
    """Kriteria lengkap `users` utk satu segmen (fungsi murni, teruji).

    `bertoken` menambah EXISTS token — hanya aman pada query yang FROM-nya
    `users` saja; query gabungan token wajib pakai `_base_filters`.
    """
    filters = _base_filters(segment, today=today)
    if segment == SEGMENT_WITH_TOKEN:
        filters.append(exists().where(FcmToken.user_id == User.id))
    return filters


def resolve_segment(segment: str) -> str:
    """Normalisasi segmen; salah/ kosong → `all` (fail-open utk UX admin)."""
    return segment if segment in SEGMENTS else SEGMENT_ALL


@dataclass(frozen=True)
class BroadcastResult:
    """Rekap satu pengiriman broadcast — masuk payload + audit log."""

    recipients: int  # user yang cocok dgn segmen
    tokens: int  # token FCM milik user tersebut
    sent: int  # kirim sukses (mode log selalu "sukses")


async def count_segment(db: AsyncSession, segment: str) -> tuple[int, int]:
    """(penerima, token) utk satu segmen — preview komposer admin.

    Hitung token memakai `_base_filters` + JOIN token (EXISTS `bertoken`
    redundan di query yang FROM-nya sudah memuat `fcm_tokens`).
    """
    recipients = int(
        await db.scalar(select(func.count()).select_from(User).where(*segment_filters(segment)))
        or 0
    )
    tokens = int(
        await db.scalar(
            select(func.count())
            .select_from(FcmToken)
            .join(User, FcmToken.user_id == User.id)
            .where(*_base_filters(segment))
        )
        or 0
    )
    return recipients, tokens


async def announce_new_mission(
    db: AsyncSession,
    mission: Any,
    *,
    sender: PushSender | None = None,
) -> int:
    """Event "misi baru" (Sprint 8): broadcast + push ke semua pengguna aktif.

    Dipanggil admin missions setelah misi tersimpan (commit milik endpoint).
    Satu baris broadcast `user_id NULL` — in-app list tiap user menampilkannya
    tanpa fan-out ribuan baris; push dikirim best-effort setelah commit.
    Return jumlah push sukses (mode log selalu "sukses").
    """
    notification = Notification(
        user_id=None,
        title="Misi baru!",
        body=f'"{mission.title}" menantimu — selesaikan dan raih +{mission.points} poin.',
        type="mission",
        payload={
            "kind": "new_mission",
            "mission_id": mission.id,
            "segment": SEGMENT_ALL,
        },
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    result = await send_broadcast(db, notification, sender=sender)
    return result.sent


async def send_broadcast(
    db: AsyncSession,
    notification: Any,
    *,
    sender: PushSender | None = None,
) -> BroadcastResult:
    """Kirim satu baris broadcast (`user_id NULL`) sebagai push ke segmen.

    Token diambil per batch lalu dikirim paralel best-effort — satu token
    gagal tidak menghentikan yang lain (pola `push_notification` Sprint 6).
    TIDAK melakukan commit/flush — pemanggil yang mengelola transaksi.
    """
    segment = resolve_segment((notification.payload or {}).get("segment", "all"))
    recipient_total = int(
        await db.scalar(select(func.count()).select_from(User).where(*segment_filters(segment)))
        or 0
    )
    token_ids = (
        await db.scalars(
            select(FcmToken.id)
            .join(User, FcmToken.user_id == User.id)
            .where(*_base_filters(segment))
            .order_by(FcmToken.id)
        )
    ).all()

    from app.services.push import get_push_sender  # import lokal: hindari lingkar import

    active_sender = sender or get_push_sender()

    sent = 0
    token_total = len(token_ids)
    for start in range(0, token_total, BROADCAST_BATCH):
        batch_ids = token_ids[start : start + BROADCAST_BATCH]
        tokens = (await db.scalars(select(FcmToken.token).where(FcmToken.id.in_(batch_ids)))).all()
        data: dict[str, Any] = {
            "notification_id": notification.id,
            "type": notification.type or "info",
            "broadcast": True,
            **(notification.payload or {}),
        }
        results = await asyncio.gather(
            *(
                active_sender.send(
                    token=token,
                    title=notification.title or "",
                    body=notification.body or "",
                    data=data,
                )
                for token in tokens
            ),
            return_exceptions=True,
        )
        for token, result in zip(tokens, results, strict=True):
            if isinstance(result, BaseException):
                logger.warning("PUSH broadcast gagal token=%s…: %s", token[:12], result)
            elif result:
                sent += 1

    return BroadcastResult(recipients=recipient_total, tokens=token_total, sent=sent)
