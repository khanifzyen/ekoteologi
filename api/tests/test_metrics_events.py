"""Test endpoint metrik event admin (Sprint 8 — persiapan metrik PRD §8)."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.metrics import KNOWN_EVENTS, track_event
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_metrics_butuh_auth(client):
    assert (await client.get("/v1/admin/metrics/events")).status_code == 401


async def test_metrics_role_guard(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get(
        "/v1/admin/metrics/events", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 403  # user biasa tidak boleh


async def test_metrics_semua_event_prd8_selalu_muncul(client, admin_user, db_session: AsyncSession):
    """Rekap menampilkan keempat nama event PRD §8 walau count 0 — dan angka
    benar setelah event ditulis lewat `track_event()` (pintu yang sama dgn
    scan/misi/streak/modul)."""
    for name in KNOWN_EVENTS:
        await track_event(db_session, user_id=admin_user.id, name=name, payload={"uji": True})
    await track_event(db_session, user_id=admin_user.id, name="streak_hari", payload={"x": 1})
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get(
        "/v1/admin/metrics/events?days=7", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["days"] == 7
    totals = {t["name"]: t["count"] for t in body["totals"]}
    assert totals == {
        "modul_selesai": 1,
        "misi_selesai": 1,
        "scan_pertama": 1,
        "streak_hari": 2,
    }
    assert len(body["daily"]) == 1  # semua event hari ini
    hari_ini = body["daily"][0]
    assert hari_ini["counts"]["streak_hari"] == 2


async def test_metrics_jendela_hari_validasi(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    assert (
        await client.get(
            "/v1/admin/metrics/events?days=0", headers={"Authorization": f"Bearer {token}"}
        )
    ).status_code == 422
    assert (
        await client.get(
            "/v1/admin/metrics/events?days=200", headers={"Authorization": f"Bearer {token}"}
        )
    ).status_code == 422
