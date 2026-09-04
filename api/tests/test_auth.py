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


# ── Sprint 1: register ──


async def test_register_sukses(client):
    resp = await client.post(
        "/v1/auth/register",
        json={
            "full_name": "Aisyah Putri",
            "email": "Aisyah@Example.COM",
            "password": "rahasia123",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["user"]["role"] == "user"
    assert body["user"]["email"] == "aisyah@example.com"
    assert body["access_token"]
    assert body["refresh_token"]

    # Token access langsung dipakai — alur daftar → masuk tanpa login ulang.
    me = await client.get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["full_name"] == "Aisyah Putri"


async def test_register_email_duplikat(client, admin_user):
    resp = await client.post(
        "/v1/auth/register",
        json={
            "full_name": "Duplikat",
            "email": "admin@example.com",
            "password": "rahasia123",
        },
    )
    assert resp.status_code == 409
    assert "terdaftar" in resp.json()["detail"].lower()


async def test_register_password_pendek(client):
    resp = await client.post(
        "/v1/auth/register",
        json={"full_name": "Si Pendek", "email": "pendek@example.com", "password": "pendek"},
    )
    assert resp.status_code == 422


async def test_register_tercatat_di_audit(client, db_session):
    await client.post(
        "/v1/auth/register",
        json={"full_name": "Auditor", "email": "audit@example.com", "password": "rahasia123"},
    )
    rows = (await db_session.scalars(select(AuditLog).where(AuditLog.action == "register"))).all()
    assert len(rows) == 1


# ── Sprint 1: refresh token ──


async def test_refresh_menghasilkan_pasangan_baru(client, member_user):
    login = await client.post(
        "/v1/auth/login", json={"email": "member@example.com", "password": "password123"}
    )
    refresh_token = login.json()["refresh_token"]

    resp = await client.post("/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["user"]["email"] == "member@example.com"

    # Access baru valid dipakai.
    me = await client.get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


async def test_refresh_dengan_access_token_ditolak(client, member_user):
    login = await client.post(
        "/v1/auth/login", json={"email": "member@example.com", "password": "password123"}
    )
    resp = await client.post(
        "/v1/auth/refresh", json={"refresh_token": login.json()["access_token"]}
    )
    assert resp.status_code == 401


async def test_refresh_token_palsu_ditolak(client):
    resp = await client.post("/v1/auth/refresh", json={"refresh_token": "token-palsu"})
    assert resp.status_code == 401


async def test_refresh_akun_nonaktif_ditolak(client, member_user, db_session):
    login = await client.post(
        "/v1/auth/login", json={"email": "member@example.com", "password": "password123"}
    )
    member_user.is_active = False
    await db_session.commit()

    resp = await client.post(
        "/v1/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}
    )
    assert resp.status_code == 401


async def test_refresh_sesi_pendek_tetap_pendek(client, member_user):
    """Tanpa "Ingat saya", rotasi refresh mempertahankan umur pendek (claim rem)."""
    from app.core.security import decode_refresh_token

    login = await client.post(
        "/v1/auth/login",
        json={"email": "member@example.com", "password": "password123", "remember": False},
    )
    assert decode_refresh_token(login.json()["refresh_token"])["rem"] is False

    resp = await client.post(
        "/v1/auth/refresh", json={"refresh_token": login.json()["refresh_token"]}
    )
    assert resp.status_code == 200
    assert decode_refresh_token(resp.json()["refresh_token"])["rem"] is False


# ── Sprint 1: rate limit login ──


async def test_login_dibatasi_setelah_5_gagal(client, member_user):
    email = "member@example.com"
    for _ in range(5):
        resp = await client.post(
            "/v1/auth/login", json={"email": email, "password": "password-salah"}
        )
        assert resp.status_code == 401

    # Percobaan ke-6 diblokir — bahkan dengan kata sandi yang benar.
    resp = await client.post("/v1/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code == 429
    assert "coba lagi" in resp.json()["detail"].lower()


async def test_login_sukses_mereset_rate_limit(client, member_user):
    email = "member@example.com"
    for _ in range(3):
        await client.post("/v1/auth/login", json={"email": email, "password": "password-salah"})

    resp = await client.post("/v1/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code == 200

    # Setelah sukses, hitungan gagal nol: 4 kegagalan lagi belum memicu blokir.
    for _ in range(4):
        resp = await client.post(
            "/v1/auth/login", json={"email": email, "password": "password-salah"}
        )
        assert resp.status_code == 401
    resp = await client.post("/v1/auth/login", json={"email": email, "password": "password123"})
    assert resp.status_code == 200


async def test_rate_limit_per_email(client, admin_user, member_user):
    """Gagal beruntun pada satu email tidak memblokir email lain."""
    for _ in range(5):
        await client.post(
            "/v1/auth/login", json={"email": "member@example.com", "password": "password-salah"}
        )
    resp = await client.post(
        "/v1/auth/login", json={"email": "admin@example.com", "password": "password123"}
    )
    assert resp.status_code == 200


async def test_login_rate_limited_tercatat_di_audit(client, member_user, db_session):
    for _ in range(5):
        await client.post(
            "/v1/auth/login", json={"email": "member@example.com", "password": "password-salah"}
        )
    await client.post(
        "/v1/auth/login", json={"email": "member@example.com", "password": "password123"}
    )
    rows = (await db_session.scalars(select(AuditLog).where(AuditLog.action == "login"))).all()
    assert any(row.diff.get("reason") == "rate_limited" for row in rows)
