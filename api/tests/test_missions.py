"""Test misi user (Sprint 4): `GET /v1/missions`, klaim photo, `GET /v1/badges`.

Termasuk anti dobel klaim (constraint `uq_user_missions_claim`), consent wajib
(§2.1 #6), periodisasi server-side, dan penolakan mode non-photo (Sprint 5).
"""

import pytest
from sqlalchemy import func, select

from app.models import UserMission
from scripts.seed import seed
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"bukti-misi-foto" * 8


def _claim_payload(**overrides):
    data = {"consent": "true"}
    data.update(overrides)
    return data


async def _create_mission(db_session, **overrides) -> int:
    from app.models import Mission

    params = {
        "title": "Setor Plastik ke Bank Sampah",
        "points": 50,
        "verification": "photo",
    }
    params.update(overrides)
    mission = Mission(**params)
    db_session.add(mission)
    await db_session.commit()
    return mission.id


async def test_daftar_misi_butuh_auth(client):
    assert (await client.get("/v1/missions")).status_code == 401
    assert (await client.get("/v1/badges")).status_code == 401


async def test_daftar_misi_kosong_dan_ringkasan_nol(client, member_user):
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/missions", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["items"] == []
    assert body["summary"] == {"week_done": 0, "week_total": 0, "week_points": 0}


async def test_daftar_misi_dengan_seed_menampilkan_klaim_kosong(client, member_user, db_session):
    await seed()
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/missions", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert body["summary"]["week_total"] >= 5
    photo = [m for m in body["items"] if m["verification"] == "photo"]
    assert photo and photo[0]["my_claim"] is None
    assert all("consent" not in m for m in body["items"])


async def test_klaim_photo_butuh_auth(client, db_session):
    mission_id = await _create_mission(db_session)
    resp = await client.post(
        f"/v1/missions/{mission_id}/claim",
        data=_claim_payload(),
        files={"file": ("bukti.png", PNG, "image/png")},
    )
    assert resp.status_code == 401


async def test_klaim_photo_sukses_masuk_antrian(client, member_user, db_session):
    mission_id = await _create_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        f"/v1/missions/{mission_id}/claim",
        data=_claim_payload(),
        files={"file": ("bukti.png", PNG, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["claim"]["status"] == "pending"
    assert "menunggu verifikasi" in body["message"].lower()
    assert body["claim"]["id"] is not None

    # Baris antrian lengkap: consent tercatat server-side + submitted_at terisi.
    row = (
        await db_session.scalars(select(UserMission).where(UserMission.mission_id == mission_id))
    ).first()
    assert row is not None
    assert row.status == "pending" and row.period_date is not None
    assert row.consent_at is not None and row.submitted_at is not None
    assert row.proof_image_url.startswith("/uploads/missions/")
    assert row.points_awarded == 0  # poin baru saat approve (Sprint 5)

    # Status user_missions='pending' terhitung di KPI antrian verifikasi (demo Sprint 4).
    total = await db_session.scalar(
        select(func.count()).select_from(UserMission).where(UserMission.status == "pending")
    )
    assert total == 1


async def test_klaim_photo_dobel_ditolak(client, member_user, db_session):
    mission_id = await _create_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    files = {"file": ("bukti.png", PNG, "image/png")}

    first = await client.post(
        f"/v1/missions/{mission_id}/claim", data=_claim_payload(), files=files, headers=headers
    )
    assert first.status_code == 201

    second = await client.post(
        f"/v1/missions/{mission_id}/claim", data=_claim_payload(), files=files, headers=headers
    )
    assert second.status_code == 409

    # Hanya ada satu baris untuk (user, mission, periode) — constraint anti dobel.
    total = await db_session.scalar(
        select(func.count()).select_from(UserMission).where(UserMission.mission_id == mission_id)
    )
    assert total == 1


async def test_klaim_tanpa_consent_ditolak(client, member_user, db_session):
    mission_id = await _create_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        f"/v1/missions/{mission_id}/claim",
        data=_claim_payload(consent="false"),
        files={"file": ("bukti.png", PNG, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "persetujuan" in resp.json()["detail"].lower()
    total = await db_session.scalar(select(func.count()).select_from(UserMission))
    assert total == 0


async def test_klaim_mode_manual_auto_approve_dan_auto_scan_ditolak(
    client, member_user, db_session
):
    """Sprint 5: manual = auto-approve (poin langsung); auto_scan tetap tidak
    bisa diklaim manual — progresnya dari scan."""
    manual_id = await _create_mission(
        db_session, title="Misi Manual", verification="manual", points=10
    )
    autoscan_id = await _create_mission(
        db_session, title="Misi Auto", verification="auto_scan", points=15, required_count=3
    )
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    # auto_scan: klaim manual ditolak 400 (kerjakan lewat scan).
    r2 = await client.post(
        f"/v1/missions/{autoscan_id}/claim",
        data={"consent": "true"},
        headers=headers,
    )
    assert r2.status_code == 400
    assert "scan" in r2.json()["detail"].lower()

    # manual: langsung approved + poin lewat ledger.
    r1 = await client.post(
        f"/v1/missions/{manual_id}/claim",
        data={},
        headers=headers,
    )
    assert r1.status_code == 201, r1.text
    body = r1.json()
    assert body["claim"]["status"] == "approved"
    assert body["claim"]["points_awarded"] == 10
    assert "+10" in body["message"]

    total = await db_session.scalar(
        select(func.count()).select_from(UserMission).where(UserMission.mission_id == manual_id)
    )
    assert total == 1


async def test_klaim_validasi_foto(client, member_user, db_session):
    mission_id = await _create_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    # Tanpa file
    r = await client.post(
        f"/v1/missions/{mission_id}/claim", data=_claim_payload(), headers=headers
    )
    assert r.status_code in (400, 422)

    # Format bukan gambar
    r = await client.post(
        f"/v1/missions/{mission_id}/claim",
        data=_claim_payload(),
        files={"file": ("bukti.txt", b"bukan foto", "text/plain")},
        headers=headers,
    )
    assert r.status_code == 400

    # Misi tidak ada
    r = await client.post(
        "/v1/missions/9999/claim",
        data=_claim_payload(),
        files={"file": ("bukti.png", PNG, "image/png")},
        headers=headers,
    )
    assert r.status_code == 404


async def test_klaim_misi_nonaktif_dan_di_luar_periode(client, member_user, db_session):
    from datetime import datetime, timedelta

    inactive_id = await _create_mission(db_session, title="Misi Mati", is_active=False)
    past_id = await _create_mission(
        db_session,
        title="Misi Lampau",
        start_at=datetime.now().astimezone() - timedelta(days=10),
        end_at=datetime.now().astimezone() - timedelta(days=2),
    )
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    files = {"file": ("bukti.png", PNG, "image/png")}

    assert (
        await client.post(
            f"/v1/missions/{inactive_id}/claim", data=_claim_payload(), files=files, headers=headers
        )
    ).status_code == 409
    assert (
        await client.post(
            f"/v1/missions/{past_id}/claim", data=_claim_payload(), files=files, headers=headers
        )
    ).status_code == 409
    # Misi di luar periode juga tidak muncul di daftar.
    resp = await client.get("/v1/missions", headers=headers)
    ids = [m["id"] for m in resp.json()["items"]]
    assert past_id not in ids and inactive_id not in ids


async def test_klaim_ulang_setelah_ditolak_mengganti_bukti(client, member_user, db_session):
    mission_id = await _create_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    first = await client.post(
        f"/v1/missions/{mission_id}/claim",
        data=_claim_payload(),
        files={"file": ("bukti1.png", PNG, "image/png")},
        headers=headers,
    )
    assert first.status_code == 201

    # Verifier menolak (simulasi state yang akan dibuat modul Sprint 5).
    from app.db.session import get_session_factory

    async with get_session_factory()() as s:
        row = (
            await s.scalars(select(UserMission).where(UserMission.mission_id == mission_id))
        ).first()
        row.status = "rejected"
        row.review_note = "Foto tidak jelas"
        await s.commit()

    second = await client.post(
        f"/v1/missions/{mission_id}/claim",
        data=_claim_payload(),
        files={"file": ("bukti2.png", PNG + b"x", "image/png")},
        headers=headers,
    )
    assert second.status_code == 201, second.text
    body = second.json()
    assert body["claim"]["status"] == "pending"
    assert body["claim"]["review_note"] is None

    total = await db_session.scalar(
        select(func.count()).select_from(UserMission).where(UserMission.mission_id == mission_id)
    )
    assert total == 1  # baris sama dipakai ulang, bukan baris baru


async def test_daftar_badges_dengan_earned_flag(client, member_user, db_session):
    await seed()
    from app.models import Badge, UserBadge

    badge = (await db_session.scalars(select(Badge).where(Badge.code == "scan_pertama"))).first()
    db_session.add(UserBadge(user_id=member_user.id, badge_id=badge.id))
    await db_session.commit()

    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/badges", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    badges = resp.json()
    assert len(badges) >= 10
    earned = [b for b in badges if b["earned"]]
    assert len(earned) == 1 and earned[0]["code"] == "scan_pertama"
    assert earned[0]["earned_at"] is not None
