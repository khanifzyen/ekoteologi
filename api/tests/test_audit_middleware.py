"""Test perilaku AuditLogMiddleware (Sprint 0, Story 5).

Middleware diuji di app dummy agar tidak tergantung endpoint bisnis yang
belum ada; perilaku yang diverifikasi: hanya method mutating yang dicatat,
actor dari JWT, dan detail route terrekam.
"""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.security import create_access_token
from app.middleware.audit_log import AuditLogMiddleware
from app.models import AuditLog

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture
async def dummy_client():
    app = FastAPI()
    app.add_middleware(AuditLogMiddleware)

    @app.post("/v1/dummy")
    async def create_dummy():
        return {"ok": True}

    @app.get("/v1/dummy")
    async def list_dummy():
        return {"ok": True}

    @app.post("/health")
    async def post_health():
        return {"ok": True}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_post_tercatat(dummy_client, db_session):
    resp = await dummy_client.post("/v1/dummy")
    assert resp.status_code == 200
    rows = (await db_session.scalars(select(AuditLog))).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.action == "post:/v1/dummy"
    assert row.entity == "dummy"
    assert row.diff["status_code"] == 200
    assert row.actor_id is None  # anonim


async def test_get_tidak_tercatat(dummy_client, db_session):
    await dummy_client.get("/v1/dummy")
    rows = (await db_session.scalars(select(AuditLog))).all()
    assert rows == []


async def test_post_health_dilewati(dummy_client, db_session):
    await dummy_client.post("/health")
    rows = (await db_session.scalars(select(AuditLog))).all()
    assert rows == []


async def test_actor_dari_jwt(dummy_client, admin_user, db_session):
    token = create_access_token(admin_user.id, admin_user.role)
    resp = await dummy_client.post("/v1/dummy", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    rows = (await db_session.scalars(select(AuditLog))).all()
    assert len(rows) == 1
    assert rows[0].actor_id == admin_user.id
