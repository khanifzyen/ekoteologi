"""Notifikasi, audit log, setting aplikasi — PRD §5.9."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # NULL = broadcast
    title: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str | None] = mapped_column(String(30))  # mission|streak|info|reward
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    """Jejak aksi mutating (middleware) + event keamanan eksplisit (mis. login)."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str | None] = mapped_column(String(50))
    entity: Mapped[str | None] = mapped_column(String(30))
    entity_id: Mapped[str | None] = mapped_column(Text)
    diff: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AnalyticsEvent(Base):
    """Event metrik produk (PRD §8) — append-only, hanya INSERT.

    Dimulai Sprint 3 dengan `scan_pertama` (aktivasi); `misi_selesai`,
    `modul_selesai`, `streak_hari` menyusul di sprint masing-masing.
    """

    __tablename__ = "analytics_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(50), index=True)  # scan_pertama | …
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
