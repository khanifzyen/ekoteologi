"""Reward / redeem (Fase 2) — PRD §5.8."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Reward(Base):
    __tablename__ = "rewards"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str | None] = mapped_column(String(150))
    image_url: Mapped[str | None] = mapped_column(Text)
    points_cost: Mapped[int | None] = mapped_column(Integer)
    stock: Mapped[int | None] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool | None] = mapped_column(Boolean, default=True, server_default="true")


class Redemption(Base):
    __tablename__ = "redemptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reward_id: Mapped[int | None] = mapped_column(ForeignKey("rewards.id"))
    points_spent: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str | None] = mapped_column(
        String(20), default="requested", server_default="requested"
    )
    processed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
