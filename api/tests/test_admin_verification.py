"""Test verifikasi admin (Sprint 5, +push Sprint 6) — `POST /v1/admin/claims/{id}/review`.

Loop tertutup: approve → poin lewat ledger + notifikasi + event `misi_selesai`
+ streak; reject → catatan wajib, tanpa poin. Role: admin & verifier saja.
Sprint 6: notifikasi in-app di-pipe ke push (mode log — tanpa kredensial FCM).
"""

import logging

import pytest
from sqlalchemy import func, select

from app.models import AnalyticsEvent, Notification, PointTransaction, UserMission
from app.services.push import register_token
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG = b"\x89PNG\r\n\x1a\n" + b"bukti-verifikasi" * 8


_setup_counter = {"n": 0}


async def _setup_claim(db_session, *, points=50):
    from datetime import date

    from app.models import Mission

    _setup_counter["n"] += 1
    user = make_user(
        email=f"pengklaim-{_setup_counter['n']}@example.com",
        full_name="Dewi Lestari",
        role="user",
        city="Bogor",
    )
    mission = Mission(title="Setor 1 kg Plastik", points=points, verification="photo")
    db_session.add_all([user, mission])
    await db_session.flush()
    claim = UserMission(
        user_id=user.id,
        mission_id=mission.id,
        period_date=date.today(),
        status="pending",
        proof_image_url="/uploads/missions/fake.png",
    )
    db_session.add(claim)
    await db_session.commit()
    return claim, mission, user


async def test_review_butuh_auth_dan_role(client, db_session):
    claim, _mission, _user = await _setup_claim(db_session)
    assert (await client.post(f"/v1/admin/claims/{claim.id}/review", json={})).status_code == 401

    # Role `user` ditolak 403.
    member = make_user(email="plain@example.com", full_name="Plain", role="user")
    db_session.add(member)
    await db_session.commit()
    token = await login_token(client, member.email, "password123")
    resp = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "approved"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_approve_memberi_poin_notif_dan_event(client, admin_user, db_session):
    claim, mission, user = await _setup_claim(db_session, points=50)
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "approved"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["points_awarded"] == 50
    assert body["reviewed_at"] is not None

    # Ledger append-only + cache users.points sinkron.
    await db_session.refresh(user)
    ledger = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.user_id == user.id)
        )
    ).all()
    assert len(ledger) == 1
    assert ledger[0].amount == 50 and ledger[0].source == "mission"
    assert ledger[0].ref_id == claim.id
    assert user.points == 50

    # Notifikasi in-app hasil verifikasi.
    notifs = (
        await db_session.scalars(select(Notification).where(Notification.user_id == user.id))
    ).all()
    assert len(notifs) == 1
    assert notifs[0].type == "mission"
    assert "disetujui" in notifs[0].title.lower()

    # Event PRD §8.
    events = (
        await db_session.scalars(
            select(AnalyticsEvent).where(AnalyticsEvent.name == "misi_selesai")
        )
    ).all()
    assert len(events) == 1
    assert events[0].payload["mission_id"] == mission.id
    assert events[0].payload["points"] == 50


async def test_approve_menaikkan_streak_pertama(client, admin_user, db_session):
    claim, _mission, user = await _setup_claim(db_session)
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "approved"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    await db_session.refresh(user)
    assert user.current_streak == 1
    assert user.longest_streak == 1
    assert user.last_active_date is not None


async def test_approve_memicu_push_ke_token_terdaftar(client, admin_user, db_session, caplog):
    """Sprint 6: notifikasi approve di-pipe ke push — mode log (tanpa kredensial)."""
    claim, _mission, user = await _setup_claim(db_session)
    await register_token(db_session, user_id=user.id, token="F" * 64)
    await db_session.commit()

    token = await login_token(client, admin_user.email, "password123")
    with caplog.at_level(logging.INFO, logger="ekoteologi.push"):
        resp = await client.post(
            f"/v1/admin/claims/{claim.id}/review",
            json={"decision": "approved"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200
    assert "PUSH (mode=log)" in caplog.text
    assert "Misi disetujui!" in caplog.text


async def test_approve_dua_kali_ditolak_409(client, admin_user, db_session):
    claim, _mission, _user = await _setup_claim(db_session)
    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}
    first = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "approved"},
        headers=headers,
    )
    assert first.status_code == 200
    second = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "approved"},
        headers=headers,
    )
    assert second.status_code == 409

    # Poin tidak dobel.
    total = await db_session.scalar(select(func.coalesce(func.sum(PointTransaction.amount), 0)))
    assert total == 50


async def test_reject_wajib_catatan(client, admin_user, db_session):
    claim, _mission, user = await _setup_claim(db_session)
    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    # Tanpa catatan → 400.
    r = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "rejected", "note": "   "},
        headers=headers,
    )
    assert r.status_code == 400
    assert "catatan" in r.json()["detail"].lower()

    # Dengan catatan → rejected + notifikasi memuat catatan + tanpa poin.
    r2 = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "rejected", "note": "Foto tidak menunjukkan timbangan."},
        headers=headers,
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["status"] == "rejected"
    assert "timbangan" in body["review_note"]

    await db_session.refresh(user)
    assert user.points == 0
    ledger = (
        await db_session.scalars(
            select(PointTransaction).where(PointTransaction.user_id == user.id)
        )
    ).all()
    assert ledger == []
    notif = (
        await db_session.scalars(select(Notification).where(Notification.user_id == user.id))
    ).first()
    assert notif is not None and "timbangan" in notif.body


async def test_reject_tidak_menaikkan_streak(client, admin_user, db_session):
    claim, _mission, user = await _setup_claim(db_session)
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "rejected", "note": "buram"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    await db_session.refresh(user)
    assert user.current_streak == 0
    assert user.last_active_date is None


async def test_review_klaim_tidak_ada(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.post(
        "/v1/admin/claims/99999/review",
        json={"decision": "approved"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 404


async def test_verifier_boleh_review_editor_tidak(client, db_session):
    claim, _mission, _user = await _setup_claim(db_session)
    verifier = make_user(email="verif@example.com", full_name="Verifier", role="verifier")
    editor = make_user(email="editor@example.com", full_name="Editor", role="editor")
    db_session.add_all([verifier, editor])
    await db_session.commit()

    vtoken = await login_token(client, verifier.email, "password123")
    ok = await client.post(
        f"/v1/admin/claims/{claim.id}/review",
        json={"decision": "approved"},
        headers={"Authorization": f"Bearer {vtoken}"},
    )
    assert ok.status_code == 200

    # Klaim kedua utk editor (sudah approved → 409, tapi sebelum itu cek 403
    # pada klaim lain: editor tidak termasuk role review).
    claim2, _m2, _u2 = await _setup_claim(db_session, points=5)
    etoken = await login_token(client, editor.email, "password123")
    forbidden = await client.post(
        f"/v1/admin/claims/{claim2.id}/review",
        json={"decision": "approved"},
        headers={"Authorization": f"Bearer {etoken}"},
    )
    assert forbidden.status_code == 403


async def test_antrian_admin_membawa_rekap_klaim_pengguna(client, admin_user, db_session):
    claim, _mission, _user = await _setup_claim(db_session)
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get(
        "/v1/admin/claims?status=pending",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["user_claims_total"] == 1
