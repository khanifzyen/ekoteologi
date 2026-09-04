"""Google Sign-In endpoint (Sprint 1) — verifikasi ID token di-mock.

Fokus test: validasi payload tokeninfo + upsert/link user. Panggilan HTTP ke
Google di-stub lewat `app.services.google.fetch_tokeninfo` (dipanggil via
atribut modul, sehingga monkeypatch efektif).
"""

import pytest

from app.models import User

pytestmark = pytest.mark.asyncio(loop_scope="session")

CLIENT_ID = "web-client-id-123.apps.googleusercontent.com"


def _tokeninfo(**overrides) -> dict:
    info = {
        "aud": CLIENT_ID,
        "iss": "https://accounts.google.com",
        "sub": "google-sub-123",
        "email": "gugel@example.com",
        "email_verified": "true",
        "name": "Gugel User",
        "picture": "https://lh3.googleusercontent.com/a/foto.jpg",
        "exp": 4102444800,  # 2100-01-01
    }
    info.update(overrides)
    return info


@pytest.fixture
def google_configured(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "google_client_id", CLIENT_ID)


@pytest.fixture
def stub_tokeninfo(monkeypatch):
    """Stub fetch_tokeninfo; isi `state["info"]`/`state["error"]` per test."""

    from app.services import google

    state: dict = {"info": _tokeninfo(), "error": None}

    async def fake_fetch(id_token: str) -> dict:
        if state["error"] is not None:
            raise state["error"]
        return state["info"]

    monkeypatch.setattr(google, "fetch_tokeninfo", fake_fetch)
    return state


async def test_google_login_buat_user_baru(client, google_configured, stub_tokeninfo):
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["email"] == "gugel@example.com"
    assert body["user"]["role"] == "user"
    assert body["user"]["full_name"] == "Gugel User"
    assert body["access_token"] and body["refresh_token"]

    me = await client.get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


async def test_google_login_idempoten(client, google_configured, stub_tokeninfo, db_session):
    from sqlalchemy import func, select

    first = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    second = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert first.json()["user"]["id"] == second.json()["user"]["id"]
    count = await db_session.scalar(select(func.count()).select_from(User))
    assert count == 1


async def test_google_login_menautkan_akun_email_sama(
    client, google_configured, stub_tokeninfo, db_session
):
    existing = User(
        email="gugel@example.com", full_name="Akun Lama", password_hash=None, role="user"
    )
    db_session.add(existing)
    await db_session.commit()

    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(existing.id)

    await db_session.refresh(existing)
    assert existing.google_sub == "google-sub-123"
    assert existing.avatar_url == "https://lh3.googleusercontent.com/a/foto.jpg"


async def test_google_belum_dikonfigurasi(client, monkeypatch, stub_tokeninfo):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "google_client_id", "")
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 503
    assert "belum dikonfigurasi" in resp.json()["detail"].lower()


async def test_google_aud_salah_ditolak(client, google_configured, stub_tokeninfo):
    stub_tokeninfo["info"] = _tokeninfo(aud="aplikasi-lain.apps.googleusercontent.com")
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 401


async def test_google_email_belum_terverifikasi_ditolak(client, google_configured, stub_tokeninfo):
    stub_tokeninfo["info"] = _tokeninfo(email_verified="false")
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 401


async def test_google_token_kedaluwarsa_ditolak(client, google_configured, stub_tokeninfo):
    stub_tokeninfo["info"] = _tokeninfo(exp=1000000000)  # 2001
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 401


async def test_google_issuer_aneh_ditolak(client, google_configured, stub_tokeninfo):
    stub_tokeninfo["info"] = _tokeninfo(iss="https://evil.example.com")
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 401


async def test_google_token_ditolak_google(client, google_configured, stub_tokeninfo):
    from app.services.google import GoogleAuthError

    stub_tokeninfo["error"] = GoogleAuthError("Sesi Google tidak valid atau kedaluwarsa.")
    resp = await client.post("/v1/auth/google", json={"id_token": "token-google"})
    assert resp.status_code == 401
