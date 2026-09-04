"""Test daftar pengguna admin (Sprint 4): `GET /v1/admin/users` — filter, level, badge."""

import pytest

from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _add_user(db_session, email, role="user", is_active=True, points=0, **extra):
    from app.core.security import hash_password

    user = make_user(
        email=email,
        full_name=email.split("@")[0].title(),
        role=role,
        is_active=is_active,
        points=points,
        password_hash=hash_password("password123"),
        **extra,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def test_users_butuh_auth_dan_role_user_ditolak(client, member_user):
    assert (await client.get("/v1/admin/users")).status_code == 401
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/admin/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


async def test_users_list_dengan_filter_dan_level(client, admin_user, db_session):
    from scripts.seed import seed

    await seed()  # ladder level utk hitungan level profil
    await _add_user(db_session, "aisyah@example.com", points=160, city="Jakarta")
    await _add_user(db_session, "verif@example.com", role="verifier")
    await _add_user(db_session, "blokir@example.com", is_active=False)

    token = await login_token(client, admin_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get("/v1/admin/users", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 4  # admin fixture + 3 baru
    assert len(body["items"]) == 4

    # Filter role
    resp = await client.get("/v1/admin/users", params={"role": "verifier"}, headers=headers)
    body = resp.json()
    assert body["total"] == 1 and body["items"][0]["role"] == "verifier"

    # Filter status nonaktif
    resp = await client.get("/v1/admin/users", params={"status": "blocked"}, headers=headers)
    body = resp.json()
    assert body["total"] == 1 and body["items"][0]["is_active"] is False

    # Pencarian q (nama/kota)
    resp = await client.get("/v1/admin/users", params={"q": "aisyah"}, headers=headers)
    assert resp.json()["total"] == 1
    resp = await client.get("/v1/admin/users", params={"q": "jakarta"}, headers=headers)
    assert resp.json()["total"] == 1

    # Level dihitung dari seed ladder (160 poin → level 3 "Sahabat Bumi")
    item = resp.json()["items"][0] if resp.json()["total"] else None
    resp = await client.get("/v1/admin/users", params={"q": "aisyah"}, headers=headers)
    item = resp.json()["items"][0]
    assert item["points"] == 160
    assert item["level"] == 3 and item["level_title"] == "Sahabat Bumi"
    assert item["email"] == "aisyah@example.com"
    assert item["created_at"]

    # Pagination
    resp = await client.get("/v1/admin/users", params={"limit": 2, "offset": 0}, headers=headers)
    body = resp.json()
    assert body["total"] == 4 and len(body["items"]) == 2


async def test_users_kosong_tetap_valid(client, admin_user):
    token = await login_token(client, admin_user.email, "password123")
    resp = await client.get(
        "/v1/admin/users",
        params={"q": "zzzz-tidak-ada"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0 and body["items"] == []
