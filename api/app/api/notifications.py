"""Notifikasi in-app (Sprint 5; broadcast sejak Sprint 8).

`GET  /v1/notifications`            — daftar notifikasi milik user + jumlah
                                      belum dibaca (badge UI).
`POST /v1/notifications/read`       — tandai dibaca massal (idempoten).
`POST /v1/notifications/{id}/read`  — tandai satu dibaca.

Sejak Sprint 8 daftar juga menyertakan **broadcast** (`user_id NULL` —
composer push admin dan pengumuman "misi baru"): satu baris untuk semua
penerima, sesuai desain skema PRD §5.9. Semantik baca tetap personal dan
jujur: `read_at` milik baris tidak bisa dipakai per-user tanpa memengaruhi
semua orang, jadi (a) `unread_count` hanya menghitung notifikasi personal
(badge tidak "nyangkut" karena broadcast), (b) endpoint tandai-baca hanya
menyentuh baris milik user (broadcast diabaikan, tetap 2xx idempoten).
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models import Notification, User
from app.schemas.gamification import NotificationOut, NotificationsPage

router = APIRouter(prefix="/v1/notifications", tags=["notifications"])


@router.get("", response_model=NotificationsPage)
async def list_notifications(
    type_: str | None = Query(default=None, alias="type"),
    unread_only: bool = False,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationsPage:
    """Notifikasi milik user + broadcast, terbaru dulu + `unread_count` badge."""
    filters = [or_(Notification.user_id == user.id, Notification.user_id.is_(None))]
    if type_ is not None:
        filters.append(Notification.type == type_)
    if unread_only:
        # unread hanya personal — broadcast tidak pernah "wajib dibaca".
        filters.append(Notification.read_at.is_(None))
        filters.append(Notification.user_id == user.id)

    total = await db.scalar(select(func.count()).select_from(Notification).where(*filters))
    unread_count = int(
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user.id,
                Notification.read_at.is_(None),
            )
        )
        or 0
    )
    rows = (
        await db.scalars(
            select(Notification)
            .where(*filters)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return NotificationsPage(
        items=[
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
        ],
        total=int(total or 0),
        unread_count=unread_count,
        limit=limit,
        offset=offset,
    )


@router.post("/read", status_code=204)
async def mark_read(
    ids: list[int] | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Tandai notifikasi dibaca — `ids` kosong/None berarti semua milik user."""
    filters = [Notification.user_id == user.id, Notification.read_at.is_(None)]
    if ids:
        filters.append(Notification.id.in_(ids))
    rows = (await db.scalars(select(Notification).where(*filters))).all()
    if not rows:
        return
    now = datetime.now().astimezone()
    for n in rows:
        n.read_at = now
    await db.commit()


@router.post("/{notification_id}/read", status_code=204)
async def mark_one_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Tandai satu notifikasi dibaca (hanya milik sendiri)."""
    notification = await db.get(Notification, notification_id)
    if notification is None or notification.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notifikasi tidak ditemukan.")
    if notification.read_at is None:
        notification.read_at = datetime.now().astimezone()
        await db.commit()
