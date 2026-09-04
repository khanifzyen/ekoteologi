"""Test notifikasi in-app (Sprint 5) — `GET /v1/notifications` + tandai dibaca."""

import pytest
from sqlalchemy import select

from app.models import Notification
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _seed_notifs(db_session, user) -> None:
    db_session.add_all(
        [
            Notification(
                user_id=user.id,
                title="Misi disetujui!",
                body='"Setor Plastik" diverifikasi — +50 poin masuk.',
                type="mission",
                payload={"mission_id": 1, "status": "approved"},
            ),
            Notification(
                user_id=user.id,
                title="Bonus streak 6 hari!",
                body="Konsistensimu terjaga 6 hari — bonus +20 poin masuk ke akunmu.",
                type="streak",
            ),
        ]
    )
    await db_session.commit()


async def test_butuh_auth(client):
    assert (await client.get("/v1/notifications")).status_code == 401


async def test_daftar_urut_baru_dengan_unread_count(client, member_user, db_session):
    await _seed_notifs(db_session, member_user)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/notifications", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["unread_count"] == 2
    assert body["items"][0]["read_at"] is None
    assert set(item["type"] for item in body["items"]) == {"mission", "streak"}

    # Filter tipe + unread_only.
    resp_m = await client.get(
        "/v1/notifications?type=mission", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp_m.json()["total"] == 1
    resp_u = await client.get(
        "/v1/notifications?unread_only=true", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp_u.json()["total"] == 2


async def test_tandai_satu_dibaca(client, member_user, db_session):
    await _seed_notifs(db_session, member_user)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    listing = (await client.get("/v1/notifications", headers=headers)).json()
    first_id = listing["items"][0]["id"]

    r = await client.post(f"/v1/notifications/{first_id}/read", headers=headers)
    assert r.status_code == 204

    after = (await client.get("/v1/notifications", headers=headers)).json()
    assert after["unread_count"] == 1
    target = next(n for n in after["items"] if n["id"] == first_id)
    assert target["read_at"] is not None

    # Idempoten — menandai ulang tidak error.
    r2 = await client.post(f"/v1/notifications/{first_id}/read", headers=headers)
    assert r2.status_code == 204
    assert (await client.get("/v1/notifications", headers=headers)).json()["unread_count"] == 1


async def test_tandai_semua_dibaca(client, member_user, db_session):
    await _seed_notifs(db_session, member_user)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.post("/v1/notifications/read", headers=headers)
    assert r.status_code == 204
    assert (await client.get("/v1/notifications", headers=headers)).json()["unread_count"] == 0


async def test_notifikasi_user_lain_terisolasi(client, db_session):
    a = make_user(email="notifa@example.com", full_name="A")
    b = make_user(email="notifb@example.com", full_name="B")
    db_session.add_all([a, b])
    await db_session.flush()
    await _seed_notifs(db_session, a)

    token_b = await login_token(client, b.email, "password123")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    body = (await client.get("/v1/notifications", headers=headers_b)).json()
    assert body["total"] == 0 and body["unread_count"] == 0

    # B tidak bisa menandai notifikasi milik A.
    notif_a = (
        await db_session.scalars(select(Notification).where(Notification.user_id == a.id))
    ).first()
    r = await client.post(f"/v1/notifications/{notif_a.id}/read", headers=headers_b)
    assert r.status_code == 404
