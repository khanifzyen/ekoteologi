"""Test misi auto_scan (Sprint 5) — progres dari scan (`progress_count`).

Aturan yang diuji: hanya scan bernilai poin yang dihitung; filter kategori
`scan_category_id`; target tercapai → approve + poin ledger + notifikasi +
event `misi_selesai`; progres tampil di `GET /v1/missions`.
"""

import hashlib

import pytest
from sqlalchemy import select

from app.models import AnalyticsEvent, Mission, Notification, PointTransaction, UserMission
from app.services.llm.mock import _MOCK_ITEMS
from tests.conftest import login_token

pytestmark = pytest.mark.asyncio(loop_scope="session")

PNG_BASE = b"\x89PNG\r\n\x1a\n"


def png_with_category(category: str, variant: int = 0) -> bytes:
    """Cari byte PNG yang hasil mock-LLM-nya jatuh ke `category` (deterministik).

    MockProvider memilih item dgn `int(sha256,16) % len(_MOCK_ITEMS)` — kandidat
    digilir sampai ketemu; `variant` memilih kandidat ke-N agar dua foto beda
    hash bisa dipaksa sama kategori (dua scan berbeda, bukan duplikat).
    """
    seen = 0
    for i in range(1000000):
        content = PNG_BASE + category.encode() + b"-" + str(i).encode()
        digest = hashlib.sha256(content).hexdigest()
        if _MOCK_ITEMS[int(digest, 16) % len(_MOCK_ITEMS)]["category"] == category:
            if seen == variant:
                return content
            seen += 1
    raise AssertionError(f"Tidak menemukan byte untuk kategori {category}")


async def _autoscan_mission(db_session, **overrides) -> Mission:
    params = {
        "title": "Scan 3 Jenis Sampah",
        "points": 15,
        "verification": "auto_scan",
        "required_count": 3,
    }
    params.update(overrides)
    mission = Mission(**params)
    db_session.add(mission)
    await db_session.commit()
    return mission


async def _scan(client, token, content):
    return await client.post(
        "/v1/scan",
        files={"file": ("foto.png", content, "image/png")},
        headers={"Authorization": f"Bearer {token}"},
    )


async def _progress_row(db_session, mission_id: int) -> UserMission | None:
    # populate_existing: scan terjadi di sesi lain (endpoint) — paksa refresh
    # atribut baris, jangan pakai objek usungan dari identity map.
    return (
        await db_session.scalars(
            select(UserMission)
            .where(UserMission.mission_id == mission_id)
            .execution_options(populate_existing=True)
        )
    ).first()


async def test_scan_menaikkan_progres_tanpa_selesai(client, member_user, db_session):
    from scripts.seed import seed

    await seed()  # kategori utk LLM mock
    mission = await _autoscan_mission(db_session, required_count=5)
    token = await login_token(client, member_user.email, "password123")

    r = await _scan(client, token, png_with_category("Plastik"))
    assert r.status_code == 200

    row = await _progress_row(db_session, mission.id)
    assert row is not None
    assert row.status == "in_progress"
    assert row.progress_count == 1
    assert row.points_awarded == 0
    assert row.period_date is not None

    # Progres tampil di daftar misi (kartu "1 dari 5 selesai").
    resp = await client.get("/v1/missions", headers={"Authorization": f"Bearer {token}"})
    items = resp.json()["items"]
    target = next(m for m in items if m["id"] == mission.id)
    assert target["my_claim"]["progress_count"] == 1
    assert target["my_claim"]["status"] == "in_progress"


async def test_target_tercapai_auto_approve_dengan_poin(client, member_user, db_session):
    from datetime import date

    from scripts.seed import seed

    await seed()
    mission = await _autoscan_mission(db_session, required_count=2)
    token = await login_token(client, member_user.email, "password123")
    headers = {"Authorization": f"Bearer {token}"}

    assert (await _scan(client, token, png_with_category("Plastik"))).status_code == 200
    assert (await _scan(client, token, png_with_category("Organik"))).status_code == 200

    row = await _progress_row(db_session, mission.id)
    assert row.status == "approved"
    assert row.progress_count == 2
    assert row.points_awarded == 15
    assert row.period_date == date.today()

    await db_session.refresh(member_user)
    sources = (
        await db_session.scalars(
            select(PointTransaction.source).where(PointTransaction.user_id == member_user.id)
        )
    ).all()
    assert sources.count("mission") == 1  # poin misi lewat ledger
    assert sources.count("scan") == 2
    # Plastik 5 + Organik 5 (scan) + 15 misi = 25 — cache users.points sinkron.
    assert member_user.points == 25

    notif = (
        await db_session.scalars(
            select(Notification).where(
                Notification.user_id == member_user.id, Notification.type == "mission"
            )
        )
    ).first()
    assert notif is not None and "otomatis" in notif.title.lower()

    event = (
        await db_session.scalars(
            select(AnalyticsEvent).where(AnalyticsEvent.name == "misi_selesai")
        )
    ).first()
    assert event is not None
    assert event.payload["mission_id"] == mission.id
    assert event.payload["points"] == 15

    # Daftar misi kini menampilkan done.
    resp = await client.get("/v1/missions", headers=headers)
    target = next(m for m in resp.json()["items"] if m["id"] == mission.id)
    assert target["my_claim"]["status"] == "approved"


async def test_scan_duplikat_tidak_menaikkan_progres(client, member_user, db_session):
    """Anti poin-farming: foto sama (poin 0) tidak menghitung progres."""
    from scripts.seed import seed

    await seed()
    mission = await _autoscan_mission(db_session, required_count=2)
    token = await login_token(client, member_user.email, "password123")

    first = await _scan(client, token, png_with_category("Plastik"))
    assert first.status_code == 200
    assert first.json()["points"] > 0

    dup = await _scan(client, token, png_with_category("Plastik"))
    assert dup.status_code == 200
    assert dup.json()["duplicate"] is True

    row = await _progress_row(db_session, mission.id)
    assert row.progress_count == 1  # hanya scan pertama yang dihitung


async def test_filter_kategori_misi(client, member_user, db_session):
    """Misi dgn `scan_category_id` hanya maju oleh kategori itu."""
    from app.models import WasteCategory
    from scripts.seed import seed

    await seed()

    plastik = (
        await db_session.scalars(select(WasteCategory).where(WasteCategory.name == "Plastik"))
    ).first()
    mission = await _autoscan_mission(
        db_session,
        title="Scan 2 Sampah Plastik",
        required_count=2,
        scan_category_id=plastik.id,
    )
    token = await login_token(client, member_user.email, "password123")

    # Scan kategori lain (Organik) → progres TIDAK maju.
    r_other = await _scan(client, token, png_with_category("Organik"))
    assert r_other.status_code == 200
    assert r_other.json()["category"]["name"] == "Organik"
    assert await _progress_row(db_session, mission.id) is None

    # Scan Plastik → progres maju.
    r_target = await _scan(client, token, png_with_category("Plastik"))
    assert r_target.status_code == 200
    row = await _progress_row(db_session, mission.id)
    assert row is not None
    assert row.progress_count == 1

    # Residu lagi → tetap 1.
    await _scan(client, token, png_with_category("Residu"))
    row = await _progress_row(db_session, mission.id)
    assert row.progress_count == 1

    # Plastik kedua (foto beda hash, kategori sama) → target 2 tercapai.
    await _scan(client, token, png_with_category("Plastik", variant=1))
    row = await _progress_row(db_session, mission.id)
    assert row.status == "approved"
    assert row.progress_count == 2


async def test_misi_auto_scan_tidak_bisa_diklaim_manual(client, member_user, db_session):
    mission = await _autoscan_mission(db_session)
    token = await login_token(client, member_user.email, "password123")
    resp = await client.post(
        f"/v1/missions/{mission.id}/claim",
        data={"consent": "true"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "scan" in resp.json()["detail"].lower()
    assert (await _progress_row(db_session, mission.id)) is None
