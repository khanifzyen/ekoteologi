"""Konten harian ekoteologi — PRD §5.6."""

from datetime import date

from sqlalchemy import Date, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class DailyContent(Base):
    __tablename__ = "daily_contents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    publish_date: Mapped[date | None] = mapped_column(Date, unique=True)
    type: Mapped[str | None] = mapped_column(String(20))  # ayat|hadis|refleksi
    title: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(100))
    eco_action: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
