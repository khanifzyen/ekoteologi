# API — Ekoteologi AR (FastAPI)

Backend MVP: FastAPI (async) + PostgreSQL (SQLAlchemy 2.0 + asyncpg) + Redis.
Struktur mengacu PRD §5 (`docs/PRD.md`), rencana Sprint 0 (`docs/implementation-plan.md` §4).

## Menjalankan lokal

```bash
docker compose up -d          # dari root repo: Postgres (55432) + Redis (56379)
uv sync                       # instal dependensi (uv)
uv run alembic upgrade head   # migrasi skema
uv run python -m scripts.create_admin   # user admin awal (ADMIN_EMAIL/ADMIN_PASSWORD via env)
uv run uvicorn app.main:app --reload --port 8100
```

- OpenAPI/Swagger: http://localhost:8100/docs
- Port 8100 (bukan 8000) agar tidak bentrok layanan lain di mesin dev.

## Konfigurasi (env)

Salin `.env.example` → `.env`. Semua via environment, tidak ada yang hardcode.

| Var | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…@localhost:55432/ekoteologi` | Postgres asyncpg |
| `REDIS_URL` | `redis://localhost:56379/0` | Cache/rate-limit (Sprint 2+) |
| `JWT_SECRET` | — | Wajib diganti di staging/prod (≥32 byte) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | Umur access token |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Dipisah koma; termasuk `capacitor://localhost` |
| `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | kosong | Sprint 2 — provider vision via env (PRD §4) |

## Struktur

```
app/
├── api/          # router: health, auth (login/me), audit-logs (admin)
├── core/         # config (pydantic-settings), security (bcrypt+JWT), deps (get_db, require_roles), redis
├── db/           # engine & session async
├── middleware/   # audit_log.py — pencatatan request mutating (Story 5)
├── models/       # 27 tabel PRD §5 (SQLAlchemy 2.0 typed)
├── schemas/      # Pydantic request/response
└── services/     # audit service (satu pintu tulis audit_logs)
alembic/          # migrasi (template async); versi awal: skema lengkap PRD §5
scripts/          # create_admin.py
tests/            # pytest + httpx (DB test terpisah: ekoteologi_test)
```

## Kontrak endpoint (Sprint 0)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/health` | — | Status app + DB + Redis (503 bila degraded) |
| POST | `/v1/auth/login` | — | `{email, password}` → JWT + profil. Gagal → 401/403, tercatat di audit |
| GET | `/v1/auth/me` | Bearer | Profil user dari token |
| GET | `/v1/audit-logs` | Bearer admin | Daftar audit log (`limit`≤100, `offset`) |
| GET | `/v1/audit-logs/count` | Bearer admin | Total baris audit |

Catatan scope: refresh token, Google Sign-In, rate limit = Story Sprint 1.

## Middleware audit log

- Mencatat POST/PUT/PATCH/DELETE (kecuali `/health`, `/v1/auth/login` — login diaudit eksplisit
  dgn status sukses/gagal) ke `audit_logs`: `actor_id` (dari JWT bila valid), `action`
  (`post:/v1/missions`), `entity`, `entity_id`, `diff` (method/path/status).
- Kegagalan penulisan audit tidak menggagalkan request (log warning).

## Test

```bash
uv run pytest          # skema test DB disiapkan otomatis (alembic upgrade via subprocess)
uv run ruff check .
uv run ruff format --check .
```
