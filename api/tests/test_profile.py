"""Profil dasar (Sprint 1): GET/PATCH profil + unggah avatar."""

import pytest

from .conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def auth_headers(client, member_user) -> dict[str, str]:
    token = await login_token(client, "member@example.com", "password123")
    return {"Authorization": f"Bearer {token}"}


async def test_profil_butuh_token(client):
    resp = await client.get("/v1/profile")
    assert resp.status_code == 401


async def test_get_profil_dengan_level_default(client, member_user):
    headers = await auth_headers(client, member_user)
    resp = await client.get("/v1/profile", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "member@example.com"
    assert body["points"] == 0
    assert body["level"] == 1
    assert body["level_title"] == "Pemula"


async def test_get_profil_level_dari_seed(client, member_user, db_session):
    from app.models import Level

    db_session.add(Level(level=1, min_points=0, title="Pemula"))
    db_session.add(Level(level=2, min_points=50, title="Penjaga Kecil"))
    member_user.points = 50
    await db_session.commit()

    headers = await auth_headers(client, member_user)
    body = (await client.get("/v1/profile", headers=headers)).json()
    assert body["level"] == 2
    assert body["level_title"] == "Penjaga Kecil"


async def test_patch_profil_nama_kota(client, member_user, db_session):
    headers = await auth_headers(client, member_user)
    resp = await client.patch(
        "/v1/profile", headers=headers, json={"full_name": "Aisyah Putri", "city": "Bandung"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["full_name"] == "Aisyah Putri"
    assert body["city"] == "Bandung"

    await db_session.refresh(member_user)
    assert member_user.full_name == "Aisyah Putri"
    assert member_user.city == "Bandung"


async def test_patch_profil_kota_kosong_jadi_null(client, member_user):
    headers = await auth_headers(client, member_user)
    await client.patch("/v1/profile", headers=headers, json={"city": "  "})
    resp = await client.get("/v1/profile", headers=headers)
    assert resp.json()["city"] is None


async def test_patch_profil_nama_terlalu_pendek(client, member_user):
    headers = await auth_headers(client, member_user)
    resp = await client.patch("/v1/profile", headers=headers, json={"full_name": "A"})
    assert resp.status_code == 422


async def test_upload_avatar_png(client, member_user, tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path / "uploads"))

    headers = await auth_headers(client, member_user)
    resp = await client.post(
        "/v1/profile/avatar",
        headers=headers,
        files={"file": ("foto.png", PNG_BYTES, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    url = resp.json()["avatar_url"]
    assert url.startswith("/uploads/avatars/") and url.endswith(".png")

    import pathlib

    settings = get_settings()
    saved = pathlib.Path(settings.upload_dir) / "avatars" / pathlib.Path(url).name
    assert saved.read_bytes().startswith(b"\x89PNG")


async def test_upload_avatar_mengganti_file_lama(client, member_user, tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path / "uploads"))
    import pathlib

    headers = await auth_headers(client, member_user)

    first = await client.post(
        "/v1/profile/avatar",
        headers=headers,
        files={"file": ("satu.png", PNG_BYTES, "image/png")},
    )
    second = await client.post(
        "/v1/profile/avatar",
        headers=headers,
        files={"file": ("dua.png", PNG_BYTES, "image/png")},
    )
    old_url = first.json()["avatar_url"]
    new_url = second.json()["avatar_url"]
    assert old_url != new_url

    avatar_dir = pathlib.Path(get_settings().upload_dir) / "avatars"
    assert (avatar_dir / pathlib.Path(new_url).name).exists()
    assert not (avatar_dir / pathlib.Path(old_url).name).exists()


async def test_upload_avatar_format_ditolak(client, member_user, tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path / "uploads"))
    headers = await auth_headers(client, member_user)
    resp = await client.post(
        "/v1/profile/avatar",
        headers=headers,
        files={"file": ("berkas.txt", b"bukan gambar", "text/plain")},
    )
    assert resp.status_code == 400


async def test_upload_avatar_kebesaran_ditolak(client, member_user, tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path / "uploads"))
    monkeypatch.setattr(get_settings(), "avatar_max_mb", 1)
    headers = await auth_headers(client, member_user)
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (1024 * 1024 + 10)
    resp = await client.post(
        "/v1/profile/avatar",
        headers=headers,
        files={"file": ("besar.png", big, "image/png")},
    )
    assert resp.status_code == 413
