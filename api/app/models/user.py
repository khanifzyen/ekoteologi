"""User & auth — PRD §5.1."""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"
    # Leaderboard MVP (PRD §5.10 #7): sort DESC dilayani scan mundur dari index ASC ini.
    __table_args__ = (Index("ix_users_points", "points"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    google_sub: Mapped[str | None] = mapped_column(
        String(64), unique=True
    )  # Subject ID token Google (Sprint 1)
    full_name: Mapped[str] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(
        String(20), default="user", server_default="user"
    )  # user|verifier|editor|admin
    points: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )  # cache ledger, jangan update langsung
    city: Mapped[str | None] = mapped_column(String(100))
    current_streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    longest_streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_active_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    fcm_tokens: Mapped[list["FcmToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class FcmToken(Base):
    __tablename__ = "fcm_tokens"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="fcm_tokens")


class Level(Base):
    __tablename__ = "levels"

    level: Mapped[int] = mapped_column(Integer, primary_key=True)
    min_points: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(50), nullable=False)
