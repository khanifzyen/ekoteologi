"""Test CRUD misi admin + antrian klaim (Sprint 4): `/v1/admin/missions*`.

Pola role panel (PRD §3): baca untuk admin|verifier|editor; tulis misi untuk
admin|editor; hapus hanya admin. Data klaim read-only (aksi approve/reject
Sprint 5).
"""

import pytest

from scripts.seed import seed
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _payload(**overrides):
    data = {
        "title": "Setor 1 kg Kertas",
        "description": "Bawa ke bank sampah terdekat.",
        "type": "daily",
        "points": 25,
        "verification": "photo",
        "required_count": 1,
    }
    data.update(overrides)
    return data


async def _login(client, db_session, email, role):
    user = make_user(email=email, full_name=email, role=role)
    db_session.add(user)
    await db_session.commit()
    return await login_token(client, email, "password123")


async def test_crud_butuh_auth_dan_role(client):
    assert (await client.get("/v1/admin/missions")).status_code == 401
    assert (await client.post("/v1/admin/missions", json=_payload())).status_code == 401


async def test_crud_menolak_role_user(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    assert (
        await client.get("/v1/admin/missions", headers={"Authorization": f"Bearer {token}"})
    ).status_code == 403
    assert (
        await client.post(
            "/v1/admin/missions", json=_payload(), headers={"Authorization": f"Bearer {token}"}
        )
    ).status_code == 403


async def test_create_read_update_delete_misi(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    # CREATE
    resp = await client.post("/v1/admin/missions", json=_payload(), headers=headers)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["id"] > 0 and created["is_active"] is True
    assert created["claims_total"] == 0 and created["claims_pending"] == 0

    # READ (list + filter)
    resp = await client.get("/v1/admin/missions", headers=headers)
    body = resp.json()
    assert body["total"] >= 1 and body["items"][0]["title"] == "Setor 1 kg Kertas"
    resp = await client.get("/v1/admin/missions", params={"q": "kertas"}, headers=headers)
    assert resp.json()["total"] == 1
    resp = await client.get("/v1/admin/missions", params={"verification": "photo"}, headers=headers)
    assert resp.json()["total"] == 1
    resp = await client.get(
        "/v1/admin/missions", params={"verification": "auto_scan"}, headers=headers
    )
    assert resp.json()["total"] == 0

    # UPDATE
    resp = await client.patch(
        f"/v1/admin/missions/{created['id']}",
        json={"points": 40, "is_active": False},
        headers=headers,
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["points"] == 40 and updated["is_active"] is False

    # DELETE (admin boleh)
    resp = await client.delete(f"/v1/admin/missions/{created['id']}", headers=headers)
    assert resp.status_code == 204
    resp = await client.get("/v1/admin/missions", headers=headers)
    assert resp.json()["total"] == 0


async def test_delete_ditolak_bila_sudah_ada_klaim(client, admin_user, member_user, db_session):
    from app.models import Mission, UserMission

    mission = Mission(title="Misi Berklaim", points=5, verification="photo")
    db_session.add(mission)
    await db_session.flush()
    db_session.add(
        UserMission(
            user_id=member_user.id, mission_id=mission.id, status="pending", period_date=None
        )
    )
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.delete(f"/v1/admin/missions/{mission.id}", headers=headers)
    assert resp.status_code == 409

    # Nonaktifkan sebagai gantinya
    resp = await client.patch(
        f"/v1/admin/missions/{mission.id}", json={"is_active": False}, headers=headers
    )
    assert resp.status_code == 200


async def test_delete_butuh_role_admin(client, db_session):
    editor_token = await _login(client, db_session, "editor@example.com", "editor")
    resp = await client.post(
        "/v1/admin/missions",
        json=_payload(),
        headers={"Authorization": f"Bearer {editor_token}"},
    )
    assert resp.status_code == 201
    mission_id = resp.json()["id"]

    # Editor boleh membuat tapi tidak boleh menghapus.
    resp = await client.delete(
        f"/v1/admin/missions/{mission_id}", headers={"Authorization": f"Bearer {editor_token}"}
    )
    assert resp.status_code == 403

    admin_token = await _login(client, db_session, "root@example.com", "admin")
    resp = await client.delete(
        f"/v1/admin/missions/{mission_id}", headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert resp.status_code == 204


async def test_validasi_payload_misi(client, admin_user, db_session):
    await seed()  # kategori utk kasus auto_scan
    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    cases = [
        ({**_payload(), "type": "bulanan"}, 400),  # tipe tak dikenal
        ({**_payload(), "verification": "telepati"}, 400),  # mode tak dikenal
        ({**_payload(), "points": 0}, 422),  # pydantic: points >= 1
        ({**_payload(), "title": "ab"}, 422),  # pydantic: min 3 char
        ({**_payload(), "start_at": "2026-09-10T00:00:00Z", "end_at": "2026-09-01T00:00:00Z"}, 400),
        ({**_payload(), "verification": "photo", "scan_category_id": 1}, 400),
        ({**_payload(), "verification": "auto_scan", "scan_category_id": 999}, 400),
    ]
    for payload, expected in cases:
        resp = await client.post("/v1/admin/missions", json=payload, headers=headers)
        assert resp.status_code == expected, f"{payload} → {resp.status_code} (harap {expected})"

    # auto_scan dengan kategori valid → lolos.
    resp = await client.get("/v1/scans/categories")
    cat_id = resp.json()[0]["id"]
    resp = await client.post(
        "/v1/admin/missions",
        json=_payload(title="Auto Scan Kertas", verification="auto_scan", scan_category_id=cat_id),
        headers=headers,
    )
    assert resp.status_code == 201


async def test_antrian_klaim_admin(client, admin_user, member_user, db_session):
    from datetime import date

    from app.models import Mission, UserMission

    mission = Mission(title="Misi Antrian", points=20, verification="photo")
    db_session.add(mission)
    await db_session.flush()
    db_session.add(
        UserMission(
            user_id=member_user.id,
            mission_id=mission.id,
            status="pending",
            period_date=date.today(),
            proof_image_url="/uploads/missions/abc.png",
        )
    )
    await db_session.commit()

    verifier_token = await _login(client, db_session, "ver@example.com", "verifier")
    headers = {"Authorization": f"Bearer {verifier_token}"}

    resp = await client.get("/v1/admin/claims", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["status"] == "pending"
    assert item["user"]["full_name"] == member_user.full_name
    assert item["mission"]["title"] == "Misi Antrian"
    assert item["proof_image_url"] == "/uploads/missions/abc.png"
    assert item["consent_at"] is None  # dibuat langsung lewat DB, bukan endpoint klaim

    # Filter status
    resp = await client.get("/v1/admin/claims", params={"status": "approved"}, headers=headers)
    assert resp.json()["total"] == 0

    # Rekap klaim pada daftar misi ikut terisi
    resp = await client.get("/v1/admin/missions", headers=headers)
    row = [m for m in resp.json()["items"] if m["id"] == mission.id][0]
    assert row["claims_total"] == 1 and row["claims_pending"] == 1
