"""Admin: composer push broadcast + trigger streak reminder (Sprint 8).

- `GET  /v1/admin/push/segments`            — rekap penerima/token per segmen
  (preview komposer sebelum kirim).
- `POST /v1/admin/push/broadcast`           — kirim push ke semua/segmen.
  **Role admin saja** (story rencana). Membuat SATU baris broadcast di
  `notifications` (`user_id NULL` — tampil untuk tiap user di in-app list)
  lalu push best-effort ke seluruh token segmen via `PushSender` aktif.
- `GET  /v1/admin/push/history`             — 20 broadcast terakhir (rekap
  recipients/tokens/sent tersimpan di payload).
- `POST /v1/admin/notifications/streak-reminder` — jalankan streak reminder
  sekarang (idempoten per hari; `force` untuk demo/ops).

Semua aksi tulis tercatat audit log dua lapis: middleware (Sprint 0) untuk
request-nya, plus audit eksplisit (`services.audit`) dengan rekap
penerima/pengiriman agar bisa diaudit tanpa membuka log aplikasi.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import Notification, User
from app.schemas.gamification import NotificationOut
from app.services.audit import record_audit
from app.services.broadcast import (
    BROADCAST_BATCH,
    SEGMENTS,
    count_segment,
    send_broadcast,
)
from app.services.streak_reminder import run_streak_reminders

logger = logging.getLogger("ekoteologi.push")

router = APIRouter(prefix="/v1/admin", tags=["admin"])

TITLE_MIN, TITLE_MAX = 4, 64
BODY_MIN, BODY_MAX = 8, 300


# ── Schemas ──


class SegmentStat(BaseModel):
    segment: str
    label: str
    recipients: int
    tokens: int


class SegmentsOut(BaseModel):
    items: list[SegmentStat]
    batch_size: int = BROADCAST_BATCH


class BroadcastRequest(BaseModel):
    title: str = Field(min_length=TITLE_MIN, max_length=TITLE_MAX)
    body: str = Field(min_length=BODY_MIN, max_length=BODY_MAX)
    segment: str = "all"


class BroadcastOut(BaseModel):
    id: int
    title: str
    body: str
    segment: str
    recipients: int
    tokens: int
    sent: int


class StreakReminderOut(BaseModel):
    date: str
    targets: int
    sent: int
    skipped: bool


# ── Segmen (preview komposer) ──


@router.get("/push/segments", response_model=SegmentsOut)
async def list_segments(
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> SegmentsOut:
    """Rekap penerima + token per segmen — ditampilkan komposer sebelum kirim."""
    items = []
    for segment, label in SEGMENTS.items():
        recipients, tokens = await count_segment(db, segment)
        items.append(
            SegmentStat(segment=segment, label=label, recipients=recipients, tokens=tokens)
        )
    return SegmentsOut(items=items, batch_size=BROADCAST_BATCH)


# ── Kirim broadcast ──


@router.post("/push/broadcast", response_model=BroadcastOut, status_code=201)
async def create_broadcast(
    payload: BroadcastRequest,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> BroadcastOut:
    """Kirim push ke semua/segmen — role admin saja + audit log rekap.

    Notifikasi in-app dibuat sebagai SATU baris broadcast (`user_id NULL`)
    dalam satu commit; push dikirim best-effort SETELAH commit — gagal push
    tidak pernah membatalkan notifikasi yang sudah sah (pola Sprint 6).
    """
    segment = payload.segment.strip() or "all"
    if segment not in SEGMENTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Segmen tidak dikenali — pilih salah satu: {', '.join(SEGMENTS)}.",
        )

    title = payload.title.strip()
    body = payload.body.strip()
    if len(title) < TITLE_MIN or len(body) < BODY_MIN:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Judul minimal {TITLE_MIN} karakter, isi minimal {BODY_MIN} karakter.",
        )

    notification = Notification(
        user_id=None,  # NULL = broadcast (desain skema PRD §5.9)
        title=title,
        body=body,
        type="info",
        payload={"kind": "broadcast", "segment": segment},
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)

    result = await send_broadcast(db, notification)
    # Rekap pengiriman ikut payload — riwayat komposer cukup dari DB.
    notification.payload = {
        "kind": "broadcast",
        "segment": segment,
        "recipients": result.recipients,
        "tokens": result.tokens,
        "sent": result.sent,
    }
    await db.commit()
    await db.refresh(notification)

    await record_audit(
        db,
        actor_id=admin.id,
        action="push.broadcast",
        entity="notification",
        entity_id=str(notification.id),
        diff={
            "title": title,
            "segment": segment,
            "recipients": result.recipients,
            "tokens": result.tokens,
            "sent": result.sent,
        },
    )
    logger.info(
        "PUSH BROADCAST id=%s segment=%s penerima=%d token=%d terkirim=%d admin=%s",
        notification.id,
        segment,
        result.recipients,
        result.tokens,
        result.sent,
        admin.id,
    )
    return BroadcastOut(
        id=notification.id,
        title=title,
        body=body,
        segment=segment,
        recipients=result.recipients,
        tokens=result.tokens,
        sent=result.sent,
    )


@router.get("/push/history", response_model=list[NotificationOut])
async def broadcast_history(
    limit: int = Query(default=20, ge=1, le=100),
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> list[NotificationOut]:
    """Broadcast terakhir (payload `kind=broadcast`) — riwayat komposer."""
    rows = (
        await db.scalars(
            select(Notification)
            .where(Notification.user_id.is_(None))
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(limit)
        )
    ).all()
    return [
        NotificationOut(
            id=n.id,
            title=n.title,
            body=n.body,
            type=n.type,
            payload=n.payload,
            read_at=n.read_at,
            created_at=n.created_at,
        )
        for n in rows
    ]


# ── Streak reminder manual (ops) ──


@router.post("/notifications/streak-reminder", response_model=StreakReminderOut)
async def trigger_streak_reminder(
    force: bool = False,
    admin: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> StreakReminderOut:
    """Jalankan streak reminder sekarang (idempoten per hari).

    `?force=true` mengabaikan penanda harian — khusus demo/ops; scheduler
    in-process memanggil logika yang sama secara otomatis.
    """
    run = await run_streak_reminders(db, force=force)
    logger.info(
        "STREAK REMINDER dipicu admin=%s targets=%d sent=%d", admin.id, run.targets, run.sent
    )
    return StreakReminderOut(
        date=run.date.isoformat(), targets=run.targets, sent=run.sent, skipped=run.skipped
    )
