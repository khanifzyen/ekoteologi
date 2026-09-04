"""Aplikasi FastAPI Ekoteologi AR."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import (
    admin_contents,
    admin_dashboard,
    admin_elearning,
    admin_metrics,
    admin_missions,
    admin_push,
    admin_users,
    admin_verification,
    audit,
    auth,
    content,
    elearning,
    health,
    leaderboard,
    missions,
    notifications,
    profile,
    push,
    scan,
    scan_history,
    streak,
)
from app.core.config import get_settings
from app.core.redis import close_redis
from app.core.sentry import init_sentry
from app.middleware.audit_log import AuditLogMiddleware
from app.middleware.rate_limit import GlobalRateLimitMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    start_scheduler()  # tugas terjadwal in-process (streak reminder — Sprint 8)
    yield
    await stop_scheduler()
    await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()
    init_sentry(settings)  # tanpa SENTRY_DSN = no-op (Sprint 8 — hardening)
    # StaticFiles menuntut direktori sudah ada saat modul diimport.
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(AuditLogMiddleware)
    app.add_middleware(GlobalRateLimitMiddleware)
    # Ditambahkan terakhir = paling luar → header terpasang bahkan pada
    # respons 429 rate limit maupun error di lapisan mana pun.
    app.add_middleware(SecurityHeadersMiddleware)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(profile.router)
    app.include_router(scan.router)
    app.include_router(scan_history.router)
    app.include_router(missions.router)
    app.include_router(elearning.router)
    app.include_router(streak.router)
    app.include_router(leaderboard.router)
    app.include_router(notifications.router)
    app.include_router(content.router)
    app.include_router(push.router)
    app.include_router(admin_missions.router)
    app.include_router(admin_verification.router)
    app.include_router(admin_contents.router)
    app.include_router(admin_elearning.router)
    app.include_router(admin_users.router)
    app.include_router(admin_dashboard.router)
    app.include_router(admin_push.router)
    app.include_router(admin_metrics.router)
    app.include_router(audit.router)
    app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
    return app


app = create_app()
