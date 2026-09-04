"""Test dashboard admin KPI read-only (Sprint 3): `GET /v1/admin/kpi`."""

import pytest

from app.models import Mission, UserMission
from scripts.seed import seed
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"kpi-foto" * 8


async def _scan(client, token):
    return await client.post(
        "/v1/scan",
        files={"file": ("f.png", PNG, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


async def test_kpi_butuh_auth_dan_role_panel(client):
    assert (await client.get("/v1/admin/kpi")).status_code == 401


async def test_kpi_menolak_role_user(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/admin/kpi", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_kpi_angka_sesuai_data(client, admin_user, member_user, db_session):
    await seed()
    token = await login_token(client, admin_user.email, "password123")
    scan_resp = await _scan(client, token)
    assert scan_resp.status_code == 200

    # Satu bukti misi menunggu verifikasi (status 'pending')
    mission = Mission(title="Misi Uji KPI", points=5, verification="photo")
    db_session.add(mission)
    await db_session.flush()
    db_session.add(UserMission(user_id=member_user.id, mission_id=mission.id, status="pending"))
    await db_session.commit()

    resp = await client.get("/v1/admin/kpi", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["users"]["total"] == 2  # admin + member
    assert body["users"]["new_7d"] == 2  # keduanya baru dibuat di test ini
    assert body["scans"]["today"] == 1
    assert body["scans"]["total"] == 1
    assert body["verification"]["pending"] == 1

    total_cache = body["cache"]["hit"] + body["cache"]["miss"]
    assert total_cache >= 1  # scan tadi menaikkan salah satu penghitung
    if body["cache"]["hit_rate"] is not None:
        assert 0 <= body["cache"]["hit_rate"] <= 100


async def test_kpi_tanpa_data_tetap_valid(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get("/v1/admin/kpi", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["users"]["total"] == 1
    assert body["scans"]["today"] == 0 and body["scans"]["total"] == 0
    assert body["verification"]["pending"] == 0
    assert body["cache"]["hit"] >= 0 and body["cache"]["miss"] >= 0
    assert body["cache"]["hit_rate"] is None or 0 <= body["cache"]["hit_rate"] <= 100
