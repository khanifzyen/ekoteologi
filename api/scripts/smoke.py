"""Smoke E2E lintas alur kritis (Sprint 8) — regresi otomatis tanpa perangkat.

Story plan Sprint 8: "QA cross-device Android … regresi semua layar vs
mockup". Perangkat fisik tidak tersedia (item terbuka sejak Sprint 0), jadi
lapisan regresi yang bisa dijalankan otomatis ditutup di sini: seluruh alur
kritis rencana §5.2 — auth, scan→poin, klaim→verifikasi→poin, kuis→lulus —
DITAMBAH alur Sprint 8 (composer push, broadcast in-app, misi baru, streak
reminder, metrik event, audit).

Pemakaian (butuh docker compose db-up):
    make api-smoke        # atau: cd api && uv run python -m scripts.smoke

Skrip mandiri: membuat DB `ekoteologi_smoke` bila belum ada, migrasi, seed,
reset data, lalu mengeksekusi 20 langkah lewat ASGI transport (tanpa port).
Keluar 0 bila semua langkah lulus.
"""

import asyncio
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
SMOKE_DATABASE_URL = os.environ.get(
    "SMOKE_DATABASE_URL",
    "postgresql+asyncpg://ekoteologi:ekoteologi@localhost:55432/ekoteologi_smoke",
)
ADMIN_EMAIL = os.environ.get("SMOKE_ADMIN_EMAIL", "admin-smoke@ekoteologi.id")
ADMIN_PASSWORD = "smoke-admin-123"
MEMBER_EMAIL = "dewi-smoke@ekoteologi.id"
MEMBER_PASSWORD = "smoke-member-123"
PUSH_TOKEN = "fKt7Qw2vS9pX1Lm3NzY6aBcD4eF5gH7iJ8kL0mN1oP2qR3sT4uV5wX6yZ7aB8cD"

os.environ["DATABASE_URL"] = SMOKE_DATABASE_URL
os.environ.setdefault("JWT_SECRET", "smoke-secret-ekoteologi-0123456789abcdef32bytes")
os.environ.setdefault("ENVIRONMENT", "smoke")

_step = 0


def check(desc: str, cond: bool, extra: str = "") -> None:
    global _step
    _step += 1
    mark = "LULUS" if cond else "GAGAL"
    print(f"[{_step:02d}] {mark} — {desc}" + (f" ({extra})" if extra else ""))
    if not cond:
        print(f"\nSmoke berhenti di langkah {_step}: {desc}")
        sys.exit(1)


def _ensure_database() -> None:
    dbname = SMOKE_DATABASE_URL.rsplit("/", 1)[-1]

    async def create() -> None:
        import asyncpg

        _, rest = SMOKE_DATABASE_URL.split("://", 1)
        userinfo, hostport_db = rest.rsplit("@", 1)
        user, password = userinfo.split(":", 1)
        host, port_db = hostport_db.split(":", 1)
        port, _ = port_db.split("/", 1)
        conn = await asyncpg.connect(
            user=user, password=password, host=host, port=int(port), database="postgres"
        )
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{dbname}"')
        await conn.close()

    asyncio.run(create())


def _migrate() -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        check=True,
        env={**os.environ, "DATABASE_URL": SMOKE_DATABASE_URL},
    )


async def _reset_and_seed() -> None:
    from sqlalchemy import text

    from app.db.session import get_engine
    from app.models import Base as ModelsBase

    tables = ", ".join(f'"{t}"' for t in ModelsBase.metadata.tables)
    async with get_engine().begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    from scripts.create_admin import create_admin
    from scripts.seed import seed

    await seed()
    await create_admin(ADMIN_EMAIL, ADMIN_PASSWORD, "Admin Smoke")


async def main() -> None:
    await _reset_and_seed()

    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import select

    from app.db.session import get_session_factory
    from app.main import app
    from app.models import AuditLog, QuizQuestion, User

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://smoke") as client:

        async def login(email: str, password: str) -> dict:
            r = await client.post("/v1/auth/login", json={"email": email, "password": password})
            detail = "" if r.status_code == 200 else r.text[:80]
            check(f"login {email}", r.status_code == 200, detail)
            return r.json()

        # ── 1. Fondasi: health + security header ──
        r = await client.get("/health")
        check("health 200", r.status_code == 200)
        check(
            "security header (nosniff/frame-deny/CSP)",
            r.headers.get("X-Content-Type-Options") == "nosniff"
            and r.headers.get("X-Frame-Options") == "DENY"
            and "frame-ancestors" in r.headers.get("Content-Security-Policy", ""),
        )

        # ── 2. Auth ──
        r = await client.post(
            "/v1/auth/register",
            json={
                "email": MEMBER_EMAIL,
                "password": MEMBER_PASSWORD,
                "full_name": "Dewi Smoke",
            },
        )
        check("register member 201/409", r.status_code in (201, 409))
        member = await login(MEMBER_EMAIL, MEMBER_PASSWORD)
        admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
        mh = {"Authorization": f"Bearer {member['access_token']}"}
        ah = {"Authorization": f"Bearer {admin['access_token']}"}

        r = await client.get("/v1/profile", headers=mh)
        check("profil poin awal 0", r.status_code == 200 and r.json()["points"] == 0)

        # ── 3. Token push terdaftar (untuk hitungan broadcast) ──
        r = await client.post(
            "/v1/push/token", json={"token": PUSH_TOKEN, "platform": "android"}, headers=mh
        )
        check("register token push", r.status_code == 200 and r.json()["registered"] is True)

        # ── 4. Scan → poin (alur kritis) ──
        png = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"smoke-scan-a" * 4 + b"\x00" * 32
        r = await client.post(
            "/v1/scan", files={"file": ("sampah.png", png, "image/png")}, headers=mh
        )
        body = r.json()
        check(
            "scan pertama 200 + poin>0",
            r.status_code == 200 and body["points"] > 0,
            f"+{body.get('points')} poin",
        )
        r = await client.post(
            "/v1/scan", files={"file": ("sampah.png", png, "image/png")}, headers=mh
        )
        check("scan duplikat → poin 0", r.json().get("points") == 0)
        r = await client.get("/v1/scans/quota", headers=mh)
        check("kuota tercatat used=2", r.json().get("used") == 2)

        # ── 5. Klaim manual → poin + streak ──
        r = await client.get("/v1/missions", headers=mh)
        misi = r.json()["items"]
        manual = next(m for m in misi if m["verification"] == "manual")
        photo = next(m for m in misi if m["verification"] == "photo")
        r = await client.post(f"/v1/missions/{manual['id']}/claim", headers=mh)
        check(
            "klaim manual → approved",
            r.status_code == 201 and r.json()["claim"]["status"] == "approved",
        )
        r = await client.get("/v1/profile", headers=mh)
        poin_setelah_manual = r.json()["points"]
        check("poin manual masuk", poin_setelah_manual >= body["points"] + manual["points"])
        r = await client.get("/v1/streak", headers=mh)
        check("streak aktif hari ini", r.json()["active_today"] is True)

        # ── 6. Klaim photo → tolak → unggah ulang → approve (loop verifikasi) ──
        bukti = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"bukti-misi" * 4
        r = await client.post(
            f"/v1/missions/{photo['id']}/claim",
            files={"file": ("bukti.png", bukti, "image/png")},
            data={"consent": "true"},
            headers=mh,
        )
        check(
            "klaim photo → pending",
            r.status_code == 201 and r.json()["claim"]["status"] == "pending",
        )
        cid = r.json()["claim"]["id"]
        r = await client.post(
            f"/v1/admin/claims/{cid}/review",
            json={"decision": "rejected"},
            headers=ah,
        )
        check("tolak tanpa catatan → 400", r.status_code == 400)

        async def pending_claim_id() -> int:
            r = await client.get("/v1/admin/claims?status=pending", headers=ah)
            return r.json()["items"][0]["id"]

        cid = await pending_claim_id()
        await client.post(
            f"/v1/admin/claims/{cid}/review",
            json={"decision": "rejected", "note": "Foto kurang jelas — unggah ulang."},
            headers=ah,
        )
        r = await client.post(
            f"/v1/missions/{photo['id']}/claim",
            files={"file": ("bukti-2.png", bukti + b"v2", "image/png")},
            data={"consent": "true"},
            headers=mh,
        )
        check("unggah ulang bukti diterima", r.status_code == 201)
        cid = await pending_claim_id()
        r = await client.post(
            f"/v1/admin/claims/{cid}/review", json={"decision": "approved"}, headers=ah
        )
        check(
            "approve verifier → approved",
            r.status_code == 200 and r.json()["status"] == "approved",
        )
        r = await client.get("/v1/profile", headers=mh)
        check(
            "poin misi photo masuk",
            r.json()["points"] == poin_setelah_manual + photo["points"],
        )

        # ── 7. E-Learning: modul → pelajaran → kuis lulus → +20 sekali ──
        r = await client.get("/v1/modules", headers=mh)
        modul = r.json()["items"]
        check("3 modul seed tayang", len(modul) >= 3, f"{len(modul)} modul")
        target = modul[0]
        r = await client.get(f"/v1/modules/{target['id']}", headers=mh)
        lessons = r.json()["lessons"]
        for lesson in lessons:
            await client.post(f"/v1/lessons/{lesson['id']}/complete", headers=mh)
        r = await client.get(f"/v1/modules/{target['id']}", headers=mh)
        check("modul tuntas via pelajaran", r.json()["progress"]["is_completed"] is True)

        async def kunci() -> list[dict[str, int]]:
            """Kunci jawaban dari DB — skrip QA boleh tahu kunci (bukan klien)."""
            r = await client.get(f"/v1/modules/{target['id']}/quiz", headers=mh)
            ids = [q["id"] for q in r.json()["questions"]]
            async with get_session_factory()() as db:
                rows = (
                    await db.scalars(select(QuizQuestion).where(QuizQuestion.id.in_(ids)))
                ).all()
                return [{"question_id": row.id, "choice": int(row.answer or 0)} for row in rows]

        async def submit_kuis() -> dict:
            r = await client.post(
                f"/v1/modules/{target['id']}/quiz",
                json={"answers": await kunci()},
                headers=mh,
            )
            return {"status": r.status_code, **(r.json() if r.status_code == 200 else {})}

        poin_sebelum_kuis = (await client.get("/v1/profile", headers=mh)).json()["points"]
        hasil1 = await submit_kuis()
        check("kuis lulus → +20", hasil1["passed"] is True and hasil1["points_awarded"] == 20)
        hasil2 = await submit_kuis()
        check("kuis ulang → 0 poin (anti dobel)", hasil2["points_awarded"] == 0)
        check(
            "poin kuis masuk sekali",
            (await client.get("/v1/profile", headers=mh)).json()["points"]
            == poin_sebelum_kuis + 20,
        )

        # ── 8. Composer push: segmen → broadcast → tampil in-app ──
        r = await client.get("/v1/admin/push/segments", headers=ah)
        seg_all = next(s for s in r.json()["items"] if s["segment"] == "all")
        check(
            "segmen semua ≥2 penerima ≥1 token",
            seg_all["recipients"] >= 2 and seg_all["tokens"] >= 1,
            f"{seg_all['recipients']} penerima/{seg_all['tokens']} token",
        )

        r = await client.post(
            "/v1/admin/push/broadcast",
            json={
                "title": "Rilis internal",
                "body": "Ekoteologi AR masuk internal testing — selamat mencoba!",
                "segment": "all",
            },
            headers=ah,
        )
        check(
            "broadcast 201 terkirim ke token",
            r.status_code == 201 and r.json()["sent"] >= 1,
            f"sent={r.json().get('sent')}",
        )

        r = await client.get("/v1/notifications", headers=mh)
        notif = r.json()
        ada_broadcast = any((n["payload"] or {}).get("kind") == "broadcast" for n in notif["items"])
        check("broadcast tampil di list member", ada_broadcast)
        r = await client.get("/v1/notifications?unread_only=true", headers=mh)
        check(
            "broadcast tidak masuk unread_count",
            all((n["payload"] or {}).get("kind") != "broadcast" for n in r.json()["items"]),
        )

        # ── 9. Event "misi baru" saat admin membuat misi ──
        r = await client.post(
            "/v1/admin/missions",
            json={
                "title": "Misi Smoke Sprint 8",
                "type": "daily",
                "points": 5,
                "verification": "manual",
                "is_active": True,
            },
            headers=ah,
        )
        check("misi baru 201", r.status_code == 201)
        r = await client.get("/v1/notifications?type=mission", headers=mh)
        check(
            "broadcast misi baru terlihat member",
            any((n["payload"] or {}).get("kind") == "new_mission" for n in r.json()["items"]),
        )

        # ── 10. Streak reminder (target diproduksi langsung di DB) ──
        kemarin = (datetime.now().astimezone() - timedelta(days=1)).date()
        async with get_session_factory()() as db:
            user = (await db.scalars(select(User).where(User.email == MEMBER_EMAIL))).first()
            user.current_streak = 3
            user.longest_streak = 3
            user.last_active_date = kemarin
            await db.commit()
        r = await client.post("/v1/admin/notifications/streak-reminder?force=true", headers=ah)
        check(
            "streak reminder target 1",
            r.status_code == 200 and r.json()["targets"] == 1,
            r.text[:100],
        )
        r = await client.post("/v1/admin/notifications/streak-reminder", headers=ah)
        check("reminder idempoten hari sama (skipped)", r.json().get("skipped") is True)

        # ── 11. Metrik event PRD §8 lengkap ──
        r = await client.get("/v1/admin/metrics/events?days=30", headers=ah)
        totals = {t["name"]: t["count"] for t in r.json()["totals"]}
        check(
            "metrik: scan_pertama/misi_selesai/streak_hari/modul_selesai tercatat",
            totals.get("scan_pertama", 0) >= 1
            and totals.get("misi_selesai", 0) >= 1
            and totals.get("streak_hari", 0) >= 1
            and totals.get("modul_selesai", 0) >= 1,
            str(totals),
        )

        # ── 12. Audit log composer + review ──
        async with get_session_factory()() as db:
            audits = (
                await db.scalars(select(AuditLog).where(AuditLog.action == "push.broadcast"))
            ).all()
            check("audit push.broadcast tercatat", len(audits) >= 1)

    print(f"\nSMOKE LULUS — {_step} langkah, alur kritis + Sprint 8 tertutup.")


if __name__ == "__main__":
    # Persiapan sinkron (DB + migrasi) SEBELUM event loop jalan; app tetap
    # diimport SETELAH env DATABASE_URL diset (pola conftest).
    _ensure_database()
    _migrate()
    asyncio.run(main())
