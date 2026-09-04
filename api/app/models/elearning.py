"""E-Learning: modul, pelajaran, kuis, progres — PRD §5.5."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Module(Base):
    __tablename__ = "modules"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(200), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(Text)
    order: Mapped[int] = mapped_column("order", Integer, default=0, server_default="0")
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class Lesson(Base):
    __tablename__ = "lessons"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    module_id: Mapped[int] = mapped_column(
        ForeignKey("modules.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)  # blok paragraph/quote/tip
    order: Mapped[int] = mapped_column("order", Integer, default=0, server_default="0")


class Quiz(Base):
    __tablename__ = "quizzes"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    module_id: Mapped[int | None] = mapped_column(ForeignKey("modules.id"))


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    quiz_id: Mapped[int | None] = mapped_column(ForeignKey("quizzes.id"))
    question: Mapped[str | None] = mapped_column(Text)
    options: Mapped[list[Any] | None] = mapped_column(JSONB)
    answer: Mapped[int | None] = mapped_column(Integer)
    explanation: Mapped[str | None] = mapped_column(Text)
    order: Mapped[int] = mapped_column("order", Integer, default=0, server_default="0")


class UserModuleProgress(Base):
    __tablename__ = "user_module_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), primary_key=True)
    module_id: Mapped[int] = mapped_column(ForeignKey("modules.id"), primary_key=True)
    lessons_done: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserQuizAttempt(Base):
    __tablename__ = "user_quiz_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    quiz_id: Mapped[int | None] = mapped_column(ForeignKey("quizzes.id"))
    score: Mapped[int | None] = mapped_column(Integer)
    total: Mapped[int | None] = mapped_column(Integer)
    answers: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSONB)
    points_awarded: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    passed: Mapped[bool | None] = mapped_column(Boolean)
    attempted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
