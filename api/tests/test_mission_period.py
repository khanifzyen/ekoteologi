"""Unit test logika periode klaim (Sprint 4) — `services.missions` (murni)."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.models import Mission
from app.services.missions import is_within_period, period_date_for


def _mission(**overrides) -> Mission:
    params = {"title": "Misi Uji", "points": 5, "verification": "photo"}
    params.update(overrides)
    return Mission(**params)


def test_period_harian_tanggal_hari_ini():
    today = date(2026, 9, 4)
    assert period_date_for(_mission(type="daily"), today) == today


def test_period_mingguan_senin_minggu_berjalan():
    # 4 Sep 2026 = Jumat → periode = Senin 31 Agt 2026.
    assert period_date_for(_mission(type="weekly"), date(2026, 9, 4)) == date(2026, 8, 31)
    # Senin sendiri → dirinya sendiri.
    assert period_date_for(_mission(type="weekly"), date(2026, 8, 31)) == date(2026, 8, 31)
    # Minggu (6 Sep) → tetap Senin yang sama dengan Jumat-nya.
    assert period_date_for(_mission(type="weekly"), date(2026, 9, 6)) == date(2026, 8, 31)


def test_period_special_dan_tanpa_type_fallback_harian():
    today = date(2026, 9, 4)
    assert period_date_for(_mission(type="special"), today) == today
    assert period_date_for(_mission(type=None), today) == today


def test_is_within_period_jendela_buka_tutup():
    now = datetime(2026, 9, 4, 9, 0, tzinfo=UTC)
    m = _mission(start_at=now - timedelta(days=1), end_at=now + timedelta(days=1))
    assert is_within_period(m, now) is True
    assert is_within_period(_mission(start_at=now + timedelta(minutes=1)), now) is False
    assert is_within_period(_mission(end_at=now - timedelta(minutes=1)), now) is False
    # Tanpa jendela → selalu aktif.
    assert is_within_period(_mission(), now) is True
    # Jendela terbalik (start di masa depan, end sudah lewat) → tidak aktif.
    assert (
        is_within_period(
            _mission(start_at=now + timedelta(days=5), end_at=now - timedelta(days=5)), now
        )
        is False
    )


@pytest.mark.parametrize("today", [date(2026, 9, 7)])
def test_period_mingguan_batas_pekan(today):
    # 7 Sep 2026 = Senin pekan baru → periode pindah pekan.
    assert period_date_for(_mission(type="weekly"), today) == date(2026, 9, 7)
