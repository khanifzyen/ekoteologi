"""Misi & klaim user — PRD §5.4."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(20), default="daily", server_default="daily")
    icon: Mapped[str | None] = mapped_column(String(100))
    points: Mapped[int] = mapped_column(Integer, nullable=False)
    verification: Mapped[str] = mapped_column(String(20), nullable=False)  # photo|auto_scan|manual
    scan_category_id: Mapped[int | None] = mapped_column(ForeignKey("waste_categories.id"))
    required_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class UserMission(Base):
    __tablename__ = "user_missions"
    __table_args__ = (
        UniqueConstraint("user_id", "mission_id", "period_date", name="uq_user_missions_claim"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    mission_id: Mapped[int] = mapped_column(ForeignKey("missions.id"), nullable=False)
    period_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(
        String(20), default="in_progress", server_default="in_progress"
    )
    progress_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    proof_image_url: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    review_note: Mapped[str | None] = mapped_column(Text)
    points_awarded: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Bukti consent foto (PRD §9 / keputusan §2.1 #6): tercatat server-side saat
    # bukti photo diklaim — bukan hanya localStorage perangkat (Sprint 4).
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
