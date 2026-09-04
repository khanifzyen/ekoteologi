"""Semua model ORM Ekoteologi AR (satu import agar Alembic melihat seluruh metadata)."""

from app.models.base import Base
from app.models.community import MapLocation, Post, PostComment, PostLike, Report
from app.models.content import DailyContent
from app.models.elearning import (
    Lesson,
    Module,
    Quiz,
    QuizQuestion,
    UserModuleProgress,
    UserQuizAttempt,
)
from app.models.gamification import Badge, PointTransaction, UserBadge
from app.models.mission import Mission, UserMission
from app.models.reward import Redemption, Reward
from app.models.scan import Scan, WasteCategory
from app.models.system import AppSetting, AuditLog, Notification
from app.models.user import FcmToken, Level, User

__all__ = [
    "AppSetting",
    "AuditLog",
    "Badge",
    "DailyContent",
    "FcmToken",
    "Lesson",
    "Level",
    "MapLocation",
    "Mission",
    "Module",
    "Notification",
    "PointTransaction",
    "Post",
    "PostComment",
    "PostLike",
    "Quiz",
    "QuizQuestion",
    "Redemption",
    "Report",
    "Reward",
    "Scan",
    "User",
    "UserBadge",
    "UserMission",
    "UserModuleProgress",
    "UserQuizAttempt",
    "WasteCategory",
    "Base",
]
