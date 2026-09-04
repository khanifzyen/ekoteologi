"""Scan + LLM — PRD §5.3."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WasteCategory(Base):
    __tablename__ = "waste_categories"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)  # Organik|Plastik|B3|Residu
    icon: Mapped[str | None] = mapped_column(String(50))
    base_points: Mapped[int] = mapped_column(Integer, default=5, server_default="5")


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    image_url: Mapped[str | None] = mapped_column(Text)
    item_name: Mapped[str | None] = mapped_column(String(100))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("waste_categories.id"))
    advice: Mapped[str | None] = mapped_column(Text)
    quote: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # {text, source}
    llm_raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # respon mentah (audit & debug)
    llm_meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # {model, latency_ms, tokens}
    points: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
