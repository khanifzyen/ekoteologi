"""Aplikasi FastAPI Ekoteologi AR."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import (
    admin_dashboard,
    admin_missions,
    admin_users,
    audit,
    auth,
    health,
    missions,
    profile,
    scan,
    scan_history,
)
from app.core.config import get_settings
from app.core.redis import close_redis
from app.middleware.audit_log import AuditLogMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    yield
    await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()
    # StaticFiles menuntut direktori sudah ada saat modul diimport.
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
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
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(profile.router)
    app.include_router(scan.router)
    app.include_router(scan_history.router)
    app.include_router(missions.router)
    app.include_router(admin_missions.router)
    app.include_router(admin_users.router)
    app.include_router(admin_dashboard.router)
    app.include_router(audit.router)
    app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
    return app


app = create_app()
