import pytest
from sqlalchemy import select

from app.models import AuditLog, User

from .conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_login_sukses(client, admin_user):
    resp = await client.post(
        "/v1/auth/login", json={"email": "admin@example.com", "password": "password123"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["role"] == "admin"
    assert "password" not in body["user"]


async def test_login_email_beda_kapital(client, admin_user):
    resp = await client.post(
        "/v1/auth/login", json={"email": "ADMIN@EXAMPLE.COM", "password": "password123"}
    )
    assert resp.status_code == 200


async def test_login_password_salah(client, admin_user):
    resp = await client.post(
        "/v1/auth/login", json={"email": "admin@example.com", "password": "salah-total"}
    )
    assert resp.status_code == 401
    assert "salah" in resp.json()["detail"].lower()


async def test_login_gagal_tercatat_di_audit(client, admin_user, db_session):
    await client.post(
        "/v1/auth/login", json={"email": "admin@example.com", "password": "salah-total"}
    )
    rows = (await db_session.scalars(select(AuditLog).where(AuditLog.action == "login"))).all()
    assert len(rows) == 1
    assert rows[0].diff["success"] is False


async def test_me_butuh_token(client):
    resp = await client.get("/v1/auth/me")
    assert resp.status_code == 401


async def test_me_dengan_token(client, admin_user):
    token = await login_token(client, "admin@example.com", "password123")
    resp = await client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "admin@example.com"


async def test_token_palsu_ditolak(client):
    resp = await client.get("/v1/auth/me", headers={"Authorization": "Bearer token-palsu"})
    assert resp.status_code == 401


async def test_akun_nonaktif_ditolak(client, db_session):
    user = User(
        email="mati@example.com",
        full_name="Nonaktif",
        role="user",
        password_hash=None,
        is_active=False,
    )
    db_session.add(user)
    await db_session.commit()

    import app.core.security as security

    user.password_hash = security.hash_password("password123")
    await db_session.commit()

    resp = await client.post(
        "/v1/auth/login", json={"email": "mati@example.com", "password": "password123"}
    )
    assert resp.status_code == 403


@pytest.mark.usefixtures("admin_user")
async def test_audit_logs_butuh_role_admin(client, member_user):
    token_member = await login_token(client, "member@example.com", "password123")
    resp = await client.get("/v1/audit-logs", headers={"Authorization": f"Bearer {token_member}"})
    assert resp.status_code == 403


async def test_audit_logs_admin(client, admin_user):
    token = await login_token(client, "admin@example.com", "password123")  # 1 aksi login tercatat
    resp = await client.get("/v1/audit-logs", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["limit"] == 20
    assert any(item["action"] == "login" for item in body["items"])
