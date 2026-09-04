"""Konfigurasi test: DB terpisah (ekoteologi_test), Redis dari env.

Urutan penting: env di-set SEBELUM modul app diimport, lalu skema disiapkan
lebih dulu via subprocess alembic (agar tidak bentrok dgn event loop test).
"""

import asyncio
import os
import subprocess
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://ekoteologi:ekoteologi@localhost:55432/ekoteologi_test",
)
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:56379/0")

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["REDIS_URL"] = REDIS_URL
os.environ.setdefault("JWT_SECRET", "test-secret-ekoteologi-0123456789abcdef32bytes")
os.environ.setdefault("ENVIRONMENT", "test")


def _ensure_database_exists() -> None:
    """Buat database test bila belum ada (admin DB = /postgres)."""

    async def create() -> None:
        import asyncpg

        # postgresql+asyncpg://user:pass@host:port/name -> argumen asyncpg
        _, rest = TEST_DATABASE_URL.split("://", 1)
        userinfo, hostport_db = rest.rsplit("@", 1)
        user, password = userinfo.split(":", 1)
        host, port_db = hostport_db.split(":", 1)
        port, dbname = port_db.split("/", 1)
        conn = await asyncpg.connect(
            user=user, password=password, host=host, port=int(port), database="postgres"
        )
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{dbname}"')
        await conn.close()

    asyncio.run(create())


def _run_migrations() -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        check=True,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
    )


_ensure_database_exists()
_run_migrations()

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.session import get_engine, get_session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, User  # noqa: E402


@pytest.fixture(scope="session")
async def engine():
    eng = get_engine()
    # Pastikan skema sinkron (idempotent — migrasi sudah jalan via subprocess).
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng


@pytest.fixture(autouse=True)
async def clean_tables(engine):
    yield
    # Bersihkan semua tabel setelah tiap test (urut FK via TRUNCATE CASCADE).
    tables = ", ".join(f'"{t}"' for t in Base.metadata.tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


@pytest.fixture
async def client(engine):
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def db_session(engine):
    async with get_session_factory()() as session:
        yield session


def make_user(**overrides) -> User:
    params = dict(
        email="admin@example.com",
        full_name="Admin Test",
        role="admin",
        password_hash=hash_password("password123"),
    )
    params.update(overrides)
    return User(**params)


@pytest.fixture
async def admin_user(db_session):
    user = make_user()
    db_session.add(user)
    await db_session.commit()
    return user


@pytest.fixture
async def member_user(db_session):
    user = make_user(email="member@example.com", full_name="Member Test", role="user")
    db_session.add(user)
    await db_session.commit()
    return user


async def login_token(client: httpx.AsyncClient, email: str, password: str) -> str:
    resp = await client.post("/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]
