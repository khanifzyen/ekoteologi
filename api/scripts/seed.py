"""Seed data awal (Sprint 1): waste_categories, levels, badges.

Idempotent — aman dijalankan berulang; baris yang sudah ada (dicocokkan lewat
kunci naturalnya) tidak diduplikasi. Jalankan: `uv run python -m scripts.seed`.
"""

import asyncio

from sqlalchemy import func, select

from app.db.session import get_engine, get_session_factory
from app.models import Badge, Level, WasteCategory

CATEGORIES: list[dict] = [
    {"name": "Organik", "icon": "fa-apple-whole", "base_points": 5},
    {"name": "Plastik", "icon": "fa-bottle-water", "base_points": 5},
    {"name": "Kertas", "icon": "fa-newspaper", "base_points": 4},
    {"name": "Kaca", "icon": "fa-wine-bottle", "base_points": 4},
    {"name": "Logam", "icon": "fa-magnet", "base_points": 5},
    {"name": "B3", "icon": "fa-biohazard", "base_points": 10},
    {"name": "Residu", "icon": "fa-trash-can", "base_points": 2},
]

# Ladder 10 level; title tampil di pill header (beranda) & kartu profil.
LEVELS: list[dict] = [
    {"level": 1, "min_points": 0, "title": "Pemula"},
    {"level": 2, "min_points": 50, "title": "Penjaga Kecil"},
    {"level": 3, "min_points": 150, "title": "Sahabat Bumi"},
    {"level": 4, "min_points": 300, "title": "Pejuang Hijau"},
    {"level": 5, "min_points": 500, "title": "Aktivis Lingkungan"},
    {"level": 6, "min_points": 750, "title": "Kader Hijau"},
    {"level": 7, "min_points": 1050, "title": "Penjaga Amanah"},
    {"level": 8, "min_points": 1400, "title": "Panglima Ekologi"},
    {"level": 9, "min_points": 1800, "title": "Khalifah Bumi"},
    {"level": 10, "min_points": 2300, "title": "Teladan Ekoteologi"},
]

# `criteria` dievaluasi badge engine (Sprint 6): {"type", "value"}.
BADGES: list[dict] = [
    {
        "code": "scan_pertama",
        "name": "Langkah Kecil",
        "icon": "fa-camera",
        "description": "Selesaikan scan sampah pertamamu.",
        "criteria": {"type": "scan_count", "value": 1},
    },
    {
        "code": "scan_10",
        "name": "Kolektor Muda",
        "icon": "fa-recycle",
        "description": "Selesaikan 10 scan sampah.",
        "criteria": {"type": "scan_count", "value": 10},
    },
    {
        "code": "scan_50",
        "name": "Ahli Memilah",
        "icon": "fa-boxes-stacked",
        "description": "Selesaikan 50 scan sampah.",
        "criteria": {"type": "scan_count", "value": 50},
    },
    {
        "code": "scan_100",
        "name": "Master Daur Ulang",
        "icon": "fa-award",
        "description": "Selesaikan 100 scan sampah.",
        "criteria": {"type": "scan_count", "value": 100},
    },
    {
        "code": "streak_7",
        "name": "Seminggu Konsisten",
        "icon": "fa-fire",
        "description": "Jaga streak aktif 7 hari berturut-turut.",
        "criteria": {"type": "streak", "value": 7},
    },
    {
        "code": "streak_30",
        "name": "Sebulan Berkah",
        "icon": "fa-calendar-check",
        "description": "Jaga streak aktif 30 hari berturut-turut.",
        "criteria": {"type": "streak", "value": 30},
    },
    {
        "code": "misi_pertama",
        "name": "Misi Pertama",
        "icon": "fa-bullseye",
        "description": "Selesaikan satu misi apa pun.",
        "criteria": {"type": "mission_done", "value": 1},
    },
    {
        "code": "misi_25",
        "name": "Aktivis Misi",
        "icon": "fa-list-check",
        "description": "Selesaikan 25 misi.",
        "criteria": {"type": "mission_done", "value": 25},
    },
    {
        "code": "kuis_10",
        "name": "Cendekiawan Hijau",
        "icon": "fa-graduation-cap",
        "description": "Lulus 10 kuis modul belajar.",
        "criteria": {"type": "quiz_passed", "value": 10},
    },
    {
        "code": "poin_1000",
        "name": "Seribu Kebaikan",
        "icon": "fa-coins",
        "description": "Kumpulkan total 1.000 poin.",
        "criteria": {"type": "points_earned", "value": 1000},
    },
]


async def seed() -> dict[str, int]:
    """Isi tabel seed. Kembalikan jumlah baris per tabel setelah seeding."""
    async with get_session_factory()() as db:
        for cat in CATEGORIES:
            exists = (
                await db.scalars(select(WasteCategory).where(WasteCategory.name == cat["name"]))
            ).first()
            if exists is None:
                db.add(WasteCategory(**cat))

        for lvl in LEVELS:
            exists = await db.get(Level, lvl["level"])
            if exists is None:
                db.add(Level(**lvl))

        for badge in BADGES:
            exists = (await db.scalars(select(Badge).where(Badge.code == badge["code"]))).first()
            if exists is None:
                db.add(Badge(**badge))

        await db.commit()

        return {
            "waste_categories": (
                await db.scalar(select(func.count()).select_from(WasteCategory)) or 0
            ),
            "levels": await db.scalar(select(func.count()).select_from(Level)) or 0,
            "badges": await db.scalar(select(func.count()).select_from(Badge)) or 0,
        }


async def main() -> None:
    counts = await seed()
    print("Seed selesai:")
    for table, count in counts.items():
        print(f"  - {table}: {count} baris")


if __name__ == "__main__":
    engine = get_engine()

    async def _run() -> None:
        try:
            await main()
        finally:
            await engine.dispose()

    asyncio.run(_run())
