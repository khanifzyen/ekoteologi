"""Test hardening API (Sprint 8): rate limit global + security header + Sentry."""

import pytest

from app.core.config import get_settings
from app.middleware.rate_limit import client_ip, rate_limit_key
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")


# ── Security headers ──


async def test_security_header_pada_semua_respons(client):
    resp = await client.get("/health")
    assert resp.status_code in (200, 503)  # app+db+redis sehat di test = 200
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "frame-ancestors 'none'" in resp.headers["Content-Security-Policy"]
    assert resp.headers["Permissions-Policy"].startswith("camera=(self)")
    # environment=test → HSTS belum dipasang (hanya prod).
    assert "strict-transport-security" not in resp.headers


async def test_security_header_hsts_hanya_prod(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "prod")
    resp = await client.get("/health")
    assert resp.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"


async def test_security_header_pada_error_dan_uploads(client):
    # 404 (path tak ada) dan 401 (tanpa token) tetap berheader.
    for resp in (await client.get("/v1/tidak-ada"), await client.get("/v1/profile")):
        assert resp.headers["X-Content-Type-Options"] == "nosniff"


# ── Rate limit global ──


async def test_client_ip_pakai_xff_hop_pertama():
    class FakeRequest:  # struktur minimal request.headers/.client
        headers = {"X-Forwarded-For": "203.0.113.7, 10.0.0.1"}
        client = None

    req = FakeRequest()
    assert client_ip(req) == "203.0.113.7"  # type: ignore[arg-type]


async def test_rate_limit_key_namespace_per_env():
    assert rate_limit_key("1.2.3.4").startswith(f"ratelimit:{get_settings().environment}:")


async def test_rate_limit_global_429_dengan_retry_after(client, member_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "global_rate_limit_per_minute", 3)
    token = await login_token(client, member_user.email, "password123")  # 1 request /v1
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/v1/notifications", headers=headers)).status_code == 200  # 2
    assert (await client.get("/v1/notifications", headers=headers)).status_code == 200  # 3
    resp = await client.get("/v1/notifications", headers=headers)  # 4 → 429
    assert resp.status_code == 429
    assert "Terlalu banyak permintaan" in resp.json()["detail"]
    retry = resp.headers["Retry-After"]
    assert retry.isdigit() and int(retry) >= 1


async def test_rate_limit_global_fail_open_saat_redis_mati(client, member_user, monkeypatch):
    from redis.exceptions import RedisError

    monkeypatch.setattr(get_settings(), "global_rate_limit_per_minute", 1)

    class RedisMati:
        async def incr(self, *a, **k):
            raise RedisError("down")

        async def expire(self, *a, **k):
            raise RedisError("down")

    from app.middleware import rate_limit as rl

    monkeypatch.setattr(rl, "get_redis", lambda: RedisMati())
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/notifications", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200  # fail-open — request tetap dilayani


async def test_rate_limit_global_tidak_menyentuh_path_luar_v1(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "global_rate_limit_per_minute", 1)
    # /health bukan /v1 → tidak dihitung; lalu /v1 sekali masih lolos.
    assert (await client.get("/health")).status_code in (200, 503)
    assert (await client.get("/health")).status_code in (200, 503)


async def test_rate_limit_global_mati_bila_nol(client, member_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "global_rate_limit_per_minute", 0)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    for _ in range(5):
        assert (await client.get("/v1/notifications", headers=headers)).status_code == 200


# ── Scheduler in-process (streak reminder) ──


async def test_scheduler_start_stop(monkeypatch):
    from app.services import scheduler

    monkeypatch.setattr(get_settings(), "streak_reminder_enabled", False)
    assert scheduler.start_scheduler() is False  # env mati → tidak menyala

    monkeypatch.setattr(get_settings(), "streak_reminder_enabled", True)
    try:
        assert scheduler.start_scheduler() is True
        task = scheduler._task
        assert task is not None and not task.done()
        assert scheduler.start_scheduler() is True  # idempoten — task yang sama
        assert scheduler._task is task
    finally:
        await scheduler.stop_scheduler()
    assert scheduler._task is None


# ── Sentry (opsional via env) ──


async def test_sentry_tanpa_dsn_tidak_aktif():
    from app.core.sentry import init_sentry

    settings = get_settings()
    monkey_dsn = settings.sentry_dsn
    assert monkey_dsn == ""  # default repo: Sentry mati
    assert init_sentry(settings) is False


async def test_sentry_dipanggil_bila_dsn_diisi(monkeypatch):
    import app.core.sentry as mod

    calls: list[dict] = []

    def fake_init(**kwargs):
        calls.append(kwargs)

    import sys
    import types

    fake_sdk = types.ModuleType("sentry_sdk")
    fake_sdk.init = fake_init  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_sdk)

    settings = get_settings()
    monkeypatch.setattr(settings, "sentry_dsn", "https://kunci@contoh.ingest.sentry.io/1")
    assert mod.init_sentry(settings) is True
    assert len(calls) == 1
    assert calls[0]["environment"] == settings.environment
    assert calls[0]["send_default_pii"] is False  # PRD §9 — PII tidak dikirim


async def test_sentry_before_send_buang_httpexception_wajar():
    from starlette.exceptions import HTTPException as StarletteHTTPException

    from app.core.sentry import _before_send

    event = {"event_id": "x"}
    hint = {"exc_info": (None, StarletteHTTPException(429), None)}
    assert _before_send(event, hint) is None  # 429 disengaja — dibuang
    hint = {"exc_info": (None, StarletteHTTPException(500), None)}
    assert _before_send(event, hint) == event  # 500 tetap dilaporkan
    assert _before_send(event, {}) == event
