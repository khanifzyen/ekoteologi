"""Test level engine (Sprint 5) — `services.levels` murni + profil/admin."""

import pytest

from app.services.levels import level_progress_percent, resolve_level
from scripts.seed import LEVELS, seed
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")


class _Row:
    """Stub baris `levels` (engine murni tidak menyentuh DB)."""

    def __init__(self, level: int, min_points: int, title: str):
        self.level = level
        self.min_points = min_points
        self.title = title


@pytest.fixture
def ladder():
    return [_Row(**item) for item in LEVELS]


def test_level_kosong_fallback_pemula():
    resolved = resolve_level([], 999)
    assert resolved.level == 1
    assert resolved.title == "Pemula"
    assert resolved.next_level is None


def test_level_nol_poin_level_pertama(ladder):
    resolved = resolve_level(ladder, 0)
    assert resolved.level == 1
    assert resolved.title == "Pemula"
    assert resolved.next_level == 2
    assert resolved.next_title == "Penjaga Kecil"
    assert resolved.next_min_points == 50
    assert resolved.points_to_next == 50


def test_level_tepat_batas_masuk_level_berikutnya(ladder):
    # 50 poin = persis min level 2 (batas inklusif).
    resolved = resolve_level(ladder, 50)
    assert resolved.level == 2
    assert resolved.next_level == 3
    assert resolved.next_min_points == 150


def test_level_tengah_rentang(ladder):
    resolved = resolve_level(ladder, 149)
    assert resolved.level == 2
    assert resolved.next_min_points == 150


def test_level_puncak_tanpa_berikutnya(ladder):
    resolved = resolve_level(ladder, 999999)
    assert resolved.level == 10
    assert resolved.title == "Teladan Ekoteologi"
    assert resolved.next_level is None
    assert resolved.next_min_points is None
    assert resolved.points_to_next is None


def test_progres_persen_level_berjalan(ladder):
    # Level 2: 50–149 (span 100). 100 poin → 50%.
    assert level_progress_percent(ladder, 100) == 50
    assert level_progress_percent(ladder, 50) == 0
    assert level_progress_percent(ladder, 149) == 99
    # Puncak → None (UI menyembunyikan bar).
    assert level_progress_percent(ladder, 999999) is None


async def test_profil_memakai_engine_dan_mengembalikan_next_level(client, member_user, db_session):
    await seed()
    member_user.points = 100
    await db_session.commit()

    token = await login_token(client, member_user.email, "password123")
    resp = await client.get("/v1/profile", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["level"] == 2
    assert body["level_title"] == "Penjaga Kecil"
    assert body["next_level"] == 3
    assert body["next_level_title"] == "Sahabat Bumi"
    assert body["next_level_points"] == 150
    assert body["current_streak"] == 0
