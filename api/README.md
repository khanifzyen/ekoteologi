# API — Ekoteologi AR (FastAPI)

Backend MVP: FastAPI (async) + PostgreSQL (SQLAlchemy 2.0 + asyncpg) + Redis.
Struktur mengacu PRD §5 (`docs/PRD.md`), rencana Sprint 0 (`docs/implementation-plan.md` §4).

## Menjalankan lokal

```bash
docker compose up -d          # dari root repo: Postgres (55432) + Redis (56379)
uv sync                       # instal dependensi (uv)
uv run alembic upgrade head   # migrasi skema
uv run python -m scripts.create_admin   # user admin awal (ADMIN_EMAIL/ADMIN_PASSWORD via env)
uv run python -m scripts.seed           # seed waste_categories, levels, badges (idempoten)
uv run uvicorn app.main:app --reload --port 8100
```

- OpenAPI/Swagger: http://localhost:8100/docs
- Port 8100 (bukan 8000) agar tidak bentrok layanan lain di mesin dev.

## Konfigurasi (env)

Salin `.env.example` → `.env`. Semua via environment, tidak ada yang hardcode.

| Var | Default | Keterangan |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…@localhost:55432/ekoteologi` | Postgres asyncpg |
| `REDIS_URL` | `redis://localhost:56379/0` | Cache & rate limit login |
| `JWT_SECRET` | — | Wajib diganti di staging/prod (≥32 byte) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Umur access token |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Umur refresh bila "Ingat saya" |
| `REFRESH_TOKEN_EXPIRE_DAYS_SHORT` | `1` | Umur refresh tanpa "Ingat saya" |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | `5` / `15` | Rate limit login per email+IP (fail-open bila Redis mati) |
| `GOOGLE_CLIENT_ID` | kosong | Web Client ID Google; tanpa ini `/v1/auth/google` → 503 |
| `UPLOAD_DIR` / `AVATAR_MAX_MB` | `var/uploads` / `2` | Penyimpanan avatar (volume-kan di prod) |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Dipisah koma; termasuk `capacitor://localhost` |
| `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` | kosong | Sprint 2 — provider vision via env (PRD §4) |

## Struktur

```
app/
├── api/          # router: health, auth (register/login/refresh/google/me), profile, audit-logs
├── core/         # config (pydantic-settings), security (bcrypt+JWT access/refresh), deps, redis
├── db/           # engine & session async
├── middleware/   # audit_log.py — pencatatan request mutating
├── models/       # 27 tabel PRD §5 (SQLAlchemy 2.0 typed)
├── schemas/      # Pydantic request/response
└── services/     # audit, rate_limit (login), google (verifikasi ID token)
alembic/          # migrasi (template async)
scripts/          # create_admin.py, seed.py (kategori sampah, level, badge)
tests/            # pytest + httpx (DB test terpisah: ekoteologi_test)
```

## Kontrak endpoint

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| GET | `/health` | — | Status app + DB + Redis (503 bila degraded) |
| POST | `/v1/auth/register` | — | `{full_name, email, password}` → pasangan token + profil. Email duplikat → 409; sandi <8 → 422 |
| POST | `/v1/auth/login` | — | `{email, password, remember?}` → pasangan token + profil. Gagal → 401/403; ≥5 gagal/15 mnt per email+IP → 429. Tercatat di audit |
| POST | `/v1/auth/refresh` | — | `{refresh_token}` → pasangan token baru (rotasi). Token bukan refresh/akun nonaktif → 401 |
| POST | `/v1/auth/google` | — | `{id_token}` (dari Google Sign-In) → pasangan token. Verifikasi `aud` vs `GOOGLE_CLIENT_ID`; email sama dengan akun lama otomatis ditautkan |
| GET | `/v1/auth/me` | Bearer | Profil ringkas user dari token |
| GET | `/v1/profile` | Bearer | Profil + `level`/`level_title` dihitung dari tabel `levels` |
| PATCH | `/v1/profile` | Bearer | Ubah `full_name`/`city`/`avatar_url` |
| POST | `/v1/profile/avatar` | Bearer | Multipart `file` (JPG/PNG/WebP, ≤2 MB) → simpan di `UPLOAD_DIR`, `avatar_url` relatif `/uploads/avatars/…` |
| GET | `/uploads/*` | — | File statis (avatar) |
| GET | `/v1/audit-logs` | Bearer admin | Daftar audit log (`limit`≤100, `offset`) |
| GET | `/v1/audit-logs/count` | Bearer admin | Total baris audit |

### Alur token (Sprint 1)

- Login/register/Google mengembalikan `{access_token, refresh_token, user}`.
- Access token umur pendek (default 60 mnt); refresh 30 hari (atau 1 hari
  tanpa "Ingat saya", dikunci lewat claim `rem` dan dipertahankan saat rotasi).
- Klien (mobile & admin) mengulang request sekali setelah `POST /v1/auth/refresh`
  berhasil; bila refresh ditolak, sesi diakhiri di sisi klien.
- Refresh bersifat stateless; pembatalan akses = `users.is_active = false`.
- Rate limit login: Redis `INCR`+`EXPIRE` per `email+IP`, sukses menghapus
  hitungan; Redis tidak tersedia → fail-open (dicatat sebagai warning).

## Middleware audit log

- Mencatat POST/PUT/PATCH/DELETE (kecuali `/health` dan seluruh `/v1/auth/*` —
  auth diaudit eksplisit di endpoint) ke `audit_logs`: `actor_id` (dari JWT bila
  valid), `action` (`post:/v1/missions`), `entity`, `entity_id`, `diff`.
- Kegagalan penulisan audit tidak menggagalkan request (log warning).

## Seed data

`uv run python -m scripts.seed` (idempoten): 7 `waste_categories`
(Organik, Plastik, Kertas, Kaca, Logam, B3, Residu — dgn icon & `base_points`),
10 `levels` (0 → 2.300 poin: Pemula s.d. Teladan Ekoteologi), 10 `badges`
(kriteria JSONB `{"type","value"}` — dievaluasi badge engine Sprint 6).

## Test

```bash
uv run pytest          # skema test DB disiapkan otomatis (alembic upgrade via subprocess)
uv run ruff check .
uv run ruff format --check .
```
