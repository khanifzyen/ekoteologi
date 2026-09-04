"""Test leaderboard MVP (Sprint 6) — index `users.points`, rank ketat,
posisi `me`, filter pengguna nonaktif/poin nol. UI penuh fase 2.
"""

import pytest

from app.services.levels import resolve_level
from scripts.seed import LEVELS
from tests.conftest import login_token, make_user

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _make_ranks(db_session) -> None:
    """Empat pengguna aktif + 1 nonaktif + 1 poin nol + tangga level seed."""
    from scripts.seed import seed

    await seed()  # levels — utk judul level di baris papan
    rows = [
        make_user(email="top@example.com", full_name="Andi Atas", points=500),
        make_user(email="dua@example.com", full_name="Budi Dua", points=300),
        make_user(email="tie-a@example.com", full_name="Citra A", points=150),
        make_user(email="tie-b@example.com", full_name="Dewi B", points=150),
        make_user(email="off@example.com", full_name="Eka Nonaktif", points=900, is_active=False),
        make_user(email="nol@example.com", full_name="Fajar Nol", points=0),
    ]
    db_session.add_all(rows)
    await db_session.commit()


async def test_leaderboard_butuh_auth(client):
    assert (await client.get("/v1/leaderboard")).status_code == 401


async def test_leaderboard_urutan_rank_dan_filter(client, member_user, db_session):
    await _make_ranks(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/leaderboard", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()

    # Nonaktif (900) & poin nol tidak dipajang — meski poinnya besar.
    names = [item["full_name"] for item in body["items"]]
    assert names == ["Andi Atas", "Budi Dua", "Citra A", "Dewi B"]
    ranks = [item["rank"] for item in body["items"]]
    assert ranks == [1, 2, 3, 3]  # kompetisi ketat: poin sama = rank sama
    assert body["total"] == 4
    assert body["items"][0]["points"] == 500
    assert body["items"][0]["level"] == 5  # 500 poin → "Aktivis Lingkungan" (seed levels)
    assert body["items"][0]["level_title"] == "Aktivis Lingkungan"
    assert all("email" not in item for item in body["items"])  # PII minimal


async def test_leaderboard_me_di_luar_jendela_limit(client, member_user, db_session):
    await _make_ranks(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/leaderboard?limit=2", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert len(body["items"]) == 2
    # member_user (poin 0) tidak masuk papan → `me` None (poin nol tak diperingkat).
    assert body["me"] is None


async def test_leaderboard_me_posisi_konsisten(client, member_user, db_session):
    await _make_ranks(db_session)
    member_user.points = 300
    await db_session.commit()
    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/leaderboard?limit=1", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["me"]["rank"] == 2  # 1 pengguna berpoin lebih tinggi (500)
    assert body["me"]["user_id"] == str(member_user.id)


def test_resolve_level_tangga_seed_konsisten():
    ladder_highest = max(lvl["min_points"] for lvl in LEVELS)
    resolved = resolve_level([], 99999)
    assert resolved.level == 1  # tangga kosong → fallback
    assert ladder_highest == 2300
