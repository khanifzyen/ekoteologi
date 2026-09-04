"""Konten harian utk mobile (Sprint 6) — kartu "Kutipan Hari Ini" `beranda.html`.

`GET /v1/daily-content` → konten terjadwal hari ini (`daily_contents`,
dikelola admin); bila tidak ada → fallback rotasi bank quote terkurasi
(`services/quotes.py`, bank yang sama dgn scan — satu sumber kebenaran).
Respons selalu 200: kartu wisdom beranda tidak pernah kosong; flag
`fallback: true` menandai konten dari bank (tanpa "Aksi hari ini").
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models import DailyContent, User
from app.schemas.content import DailyContentOut
from app.services.quotes import daily_fallback_quote

router = APIRouter(prefix="/v1", tags=["content"])


@router.get("/daily-content", response_model=DailyContentOut)
async def get_daily_content(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DailyContentOut:
    """Konten hari ini: terjadwal (admin) atau fallback bank quote."""
    del user  # auth diperlukan agar kartu personal, datanya sendiri sama utk semua
    today = datetime.now().astimezone().date()
    content = (
        await db.scalars(select(DailyContent).where(DailyContent.publish_date == today))
    ).first()
    if content is not None:
        return DailyContentOut(
            date=today,
            type=content.type or "refleksi",
            title=content.title,
            body=content.body or "",
            source=content.source,
            eco_action=content.eco_action,
            fallback=False,
        )

    quote = daily_fallback_quote(today)
    return DailyContentOut(
        date=today,
        type="fallback",
        title=None,
        body=quote.text,
        source=quote.source,
        eco_action=None,
        fallback=True,
    )
