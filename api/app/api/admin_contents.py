"""Admin: CRUD konten harian (Sprint 6) — `daily_contents` PRD §5.6.

- `GET    /v1/admin/contents`        — daftar + filter status jadwal.
- `POST   /v1/admin/contents`        — jadwalkan konten utk satu tanggal
  (`publish_date` UNIQUE → bentrok = 409, satu konten per hari).
- `PATCH  /v1/admin/contents/{id}`   — ubah isi / geser jadwal.
- `DELETE /v1/admin/contents/{id}`   — hapus (admin saja).

Penjadwalan MVP = `publish_date` (tanggal tayang): konten dengan
`publish_date == hari ini` tayang di kartu "Kutipan Hari Ini" `beranda.html`
via `GET /v1/daily-content` (`api/content.py`). Tanpa cron — tanggal adalah
jadwalnya (lazy, konsisten dgn pola streak Sprint 5).
"""

import logging
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.models import DailyContent, User
from app.schemas.content import CONTENT_TYPES, ContentCreate, ContentOut, ContentUpdate

logger = logging.getLogger("ekoteologi.contents")

router = APIRouter(prefix="/v1/admin", tags=["admin"])


def _out(content: DailyContent, today: date_type) -> ContentOut:
    return ContentOut(
        id=content.id,
        publish_date=content.publish_date,
        type=content.type or "refleksi",
        title=content.title,
        body=content.body or "",
        source=content.source,
        eco_action=content.eco_action,
        image_url=content.image_url,
        is_published=bool(content.publish_date and content.publish_date <= today),
    )


def _validate_type(type_: str | None) -> None:
    if type_ is not None and type_ not in CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Tipe konten harus salah satu dari: {', '.join(CONTENT_TYPES)}.",
        )


async def _get_or_404(db: AsyncSession, content_id: int) -> DailyContent:
    content = await db.get(DailyContent, content_id)
    if content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Konten tidak ditemukan.")
    return content


@router.get("/contents", response_model=list[ContentOut])
async def list_contents(
    schedule: str | None = Query(default=None),  # upcoming|published
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(require_roles("admin", "verifier", "editor")),
    db: AsyncSession = Depends(get_db),
) -> list[ContentOut]:
    """Daftar konten harian (terdekat dulu) + filter status jadwal."""
    today = date_type.today()
    stmt = select(DailyContent).order_by(DailyContent.publish_date.desc(), DailyContent.id.desc())
    if schedule == "upcoming":
        stmt = stmt.where(DailyContent.publish_date > today)
    elif schedule == "published":
        stmt = stmt.where(DailyContent.publish_date <= today)
    rows = (await db.scalars(stmt.offset(offset).limit(limit))).all()
    return [_out(c, today) for c in rows]


@router.post("/contents", response_model=ContentOut, status_code=201)
async def create_content(
    payload: ContentCreate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> ContentOut:
    _validate_type(payload.type)
    clash = (
        await db.scalars(
            select(DailyContent).where(DailyContent.publish_date == payload.publish_date)
        )
    ).first()
    if clash is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Tanggal {payload.publish_date.isoformat()} sudah terisi — pilih tanggal lain.",
        )
    content = DailyContent(
        publish_date=payload.publish_date,
        type=payload.type,
        title=payload.title,
        body=payload.body.strip(),
        source=payload.source,
        eco_action=payload.eco_action,
        image_url=payload.image_url,
    )
    db.add(content)
    try:
        await db.commit()
    except IntegrityError:  # race dua admin menembus cek
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Tanggal {payload.publish_date.isoformat()} baru saja diisi — muat ulang daftar.",
        ) from None
    await db.refresh(content)
    logger.info(
        "CONTENT CREATED id=%s date=%s type=%s", content.id, content.publish_date, content.type
    )
    return _out(content, date_type.today())


@router.patch("/contents/{content_id}", response_model=ContentOut)
async def update_content(
    content_id: int,
    payload: ContentUpdate,
    _user: User = Depends(require_roles("admin", "editor")),
    db: AsyncSession = Depends(get_db),
) -> ContentOut:
    content = await _get_or_404(db, content_id)
    data = payload.model_dump(exclude_unset=True)

    new_date = data.get("publish_date", content.publish_date)
    if new_date is not None and new_date != content.publish_date:
        clash = (
            await db.scalars(select(DailyContent).where(DailyContent.publish_date == new_date))
        ).first()
        if clash is not None and clash.id != content.id:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Tanggal {new_date.isoformat()} sudah terisi — pilih tanggal lain.",
            )
        content.publish_date = new_date
    if "type" in data:
        _validate_type(data["type"])
        content.type = data["type"]

    for field in ("title", "source", "eco_action", "image_url"):
        if field in data:
            setattr(content, field, data[field])
    if "body" in data and data["body"] is not None:
        content.body = data["body"].strip()

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Tanggal ini baru saja diisi konten lain."
        ) from None
    await db.refresh(content)
    logger.info("CONTENT UPDATED id=%s", content.id)
    return _out(content, date_type.today())


@router.delete("/contents/{content_id}", status_code=204)
async def delete_content(
    content_id: int,
    _user: User = Depends(require_roles("admin")),
    db: AsyncSession = Depends(get_db),
) -> None:
    content = await _get_or_404(db, content_id)
    await db.delete(content)
    await db.commit()
    logger.info("CONTENT DELETED id=%s", content_id)


async def content_count(db: AsyncSession) -> int:
    """Rekap kecil utk halaman admin (tidak diekspos sebagai KPI terpisah)."""
    return int(await db.scalar(select(func.count()).select_from(DailyContent)) or 0)
