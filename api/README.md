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
| `LLM_MODE` | `mock` | `mock` (default — biaya nol saat dev/test) atau `live` (provider vision) |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | kosong | Provider vision OpenAI-compatible (PRD §4); wajib utk `live` — tanpa ini fallback ke mock |
| `LLM_FALLBACK_MODEL` | kosong | Model kedua bila primer gagal setelah retry (PRD §4) |
| `LLM_TIMEOUT_SECONDS` / `LLM_MAX_RETRIES` / `LLM_RETRY_BACKOFF_SECONDS` | `30` / `1` / `0.5` | Timeout + retry per model (retry juga dipicu respons tidak valid) |
| `SCAN_DAILY_LIMIT` | `20` | Kuota scan/user/hari (keputusan §2.1 #2 — default sementara, bisa diubah PO) |
| `SCAN_IMAGE_MAX_MB` | `5` | Batas ukuran foto scan (JPG/PNG/WebP via magic bytes) |
| `SCAN_CACHE_TTL_HOURS` / `SCAN_CACHE_SCHEMA` | `24` / `v1` | TTL cache Redis per hash foto; naikkan schema utk menggusur cache lama |

## Struktur

```
app/
├── api/          # router: health, auth (register/login/refresh/google/me), profile, scan,
│                 # scan_history (riwayat/kuota/kategori), admin_dashboard (KPI), audit-logs
├── core/         # config (pydantic-settings), security (bcrypt+JWT access/refresh), deps, redis
├── db/           # engine & session async
├── middleware/   # audit_log.py — pencatatan request mutating
├── models/       # 27 tabel PRD §5 + analytics_events (metrik, Sprint 3)
├── schemas/      # Pydantic request/response
└── services/     # audit, rate_limit (login), google, llm (adapter+mock+openai-compat),
                  # scan_cache, scan_limit, ledger (poin), quotes (bank terkurasi),
                  # metrics (event aktivasi — Sprint 3)
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
| POST | `/v1/scan` | Bearer | Multipart `file` foto (JPG/PNG/WebP, ≤`SCAN_IMAGE_MAX_MB`) → hasil analisis LLM tervalidasi (lihat "Arsitektur Scan AI"). 400/413 foto tidak valid, 429 kuota harian habis (+ header `Retry-After`), 503 Redis mati (fail-closed), 502 LLM gagal setelah retry+fallback |
| GET | `/v1/scans` | Bearer | Riwayat scan milik user, terbaru dulu. Query: `category_id?`, `limit` (1–50, default 20), `offset` → `{items, total, limit, offset}` |
| GET | `/v1/scans/categories` | — | Daftar kategori sampah (seed) utk filter chips — `{id, name, icon, base_points}` |
| GET | `/v1/scans/quota` | Bearer | Pemakaian kuota hari ini tanpa mengkonsumsi slot → `{used, limit, remaining, resets_in_seconds}`. Redis mati → 503 (UI menyembunyikan pill kuota) |
| GET | `/v1/missions` | Bearer | Daftar misi aktif dalam jendela periode + klaim saya periode berjalan (`my_claim`) + ringkasan mingguan (`{week_done, week_total, week_points}`) |
| POST | `/v1/missions/{id}/claim` | Bearer | Klaim misi **photo**: multipart `file` bukti (JPG/PNG/WebP, ≤`MISSION_IMAGE_MAX_MB`) + `consent=true` (wajib — PRD §9, tercatat di `user_missions.consent_at`) → status `pending` (antrian verifikasi). 409 misi nonaktif/di luar periode/sudah diklaim periode ini; 400 mode non-photo (menyusul Sprint 5)/tanpa consent/format salah; 413 ukuran. Bukti yang **ditolak** boleh diganti (baris sama di-reset). Poin baru diberikan saat approve (Sprint 5) |
| GET | `/v1/badges` | Bearer | Lencana + flag `earned`/`earned_at` milik user (tab Pencapaian; pemberian otomatis = badge engine Sprint 6) |
| GET | `/v1/admin/kpi` | Bearer panel | KPI dashboard read-only → `{users, scans, verification:{pending}, cache:{hit,miss,hit_rate}, llm:{cost_month, tokens_month, budget_monthly}}` — biaya LLM = token bulan berjalan (scan non-cache) × `LLM_COST_PER_1K_TOKENS` |
| GET | `/v1/admin/charts` | Bearer panel | Data 2 chart dashboard: `daily` (scan/hari `days`=7–30, default 14, hari kosong = 0) & `categories` (7 hari, terbanyak dulu, persentase) |
| GET | `/v1/admin/missions` | Bearer panel | Daftar misi + rekap klaim (`claims_total`, `claims_pending`). Query: `is_active?`, `verification?`, `q?` (judul), `limit` (1–100), `offset` |
| POST | `/v1/admin/missions` | Bearer admin·editor | Buat misi `{title, description?, type: daily\|weekly\|special, icon?, points, verification: photo\|auto_scan\|manual, scan_category_id? (wajib utk auto_scan), required_count?, start_at?, end_at?, is_active?}` → 201. Validasi: `start_at < end_at`, kategori harus ada |
| PATCH | `/v1/admin/missions/{id}` | Bearer admin·editor | Ubah sebagian field misi (termasuk `is_active` utk nonaktifkan) |
| DELETE | `/v1/admin/missions/{id}` | Bearer admin | Hapus misi; 409 bila sudah punya klaim (nonaktifkan saja — jaga riwayat) |
| GET | `/v1/admin/claims` | Bearer panel | Antrian klaim (`user_missions` + user + misi, terbaru dulu). Query: `status?`, `mission_id?`, `limit`, `offset`. Read-only — aksi approve/reject = modul Verifikasi (Sprint 5) |
| GET | `/v1/admin/users` | Bearer panel | Daftar pengguna (+level dihitung dari `levels`). Query: `q?` (nama/email/kota), `role?`, `status?` (active\|blocked), `limit`, `offset` |
| GET | `/uploads/*` | — | File statis (avatar, foto scan, bukti misi) |
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

### Arsitektur Scan AI (Sprint 2)

**Prinsip (PRD §4):** app tidak pernah memanggil LLM langsung — semua via
backend: API key aman, rate limit per user, caching, audit (`llm_raw`,
`llm_meta` di `scans`), fallback model.

`POST /v1/scan` (multipart `file`, Bearer token):

1. Validasi foto (ukuran ≤`SCAN_IMAGE_MAX_MB`, JPG/PNG/WebP via magic bytes).
2. Kuota harian per user (`SCAN_DAILY_LIMIT`) — Redis `INCR` per user+tanggal,
   **fail-closed** bila Redis mati (503): pelindung budget LLM (kebalikan rate
   limit login yang fail-open). Upload rusak tidak memakan kuota.
3. Cache Redis per **hash SHA-256 foto** (`scan:cache:{env}:{schema}:{hash}`,
   TTL `SCAN_CACHE_TTL_HOURS`) → HIT: respons instan tanpa LLM (biaya nol);
   hit/miss dicatat di `scan:stats:{env}:hit|miss` (dasar metrik hit rate
   ≥70% PRD §8, dashboard menyusul Sprint 4). Cache fail-open (miss saja).
4. MISS → provider LLM (`get_llm_provider()`): `mock` (default dev/test,
   deterministik per hash foto) atau `live` (OpenAI-compatible). Retry per
   model (timeout/429/5xx/respons tidak valid) lalu fallback ke
   `LLM_FALLBACK_MODEL`; gagal total → 502, tidak tersimpan.
5. Respons LLM divalidasi ketat (Pydantic `ScanLLMResult`: `{item_name,
   category, advice, quote, points}`); kategori wajib salah satu kategori DB
   (dicocokkan case-insensitive). **Quote selalu diganti bank terkurasi**
   (`services/quotes.py`) — anti-halusinasi (PRD §9).
6. Poin = min(usulan LLM, `base_points` kategori) → ledger append-only
   (`services/ledger.py`) + sinkron `users.points` (PRD §5.10 #1). Foto
   duplikat (hash sama, user sama, hari sama) → poin 0 (anti poin-farming).
7. Baris `scans` tersimpan lengkap: `llm_raw` (respon mentah) + `llm_meta`
   ({provider, model, latency_ms, tokens, attempts, fallback_used, cached})
   — PRD §5.3 — dan foto di `UPLOAD_DIR/scans/` (dilayani `/uploads`).

Contoh respons:

```json
{
  "id": 1, "item_name": "Botol plastik bekas air mineral",
  "category": {"id": 2, "name": "Plastik", "icon": "fa-bottle-water"},
  "advice": "Kosongkan, bilas, …", "quote": {"text": "…", "source": "QS Al-An'am: 141"},
  "points": 5, "points_total": 5, "cached": false, "duplicate": false,
  "image_url": "/uploads/scans/…png", "created_at": "…"
}
```

Mengaktifkan provider asli di staging/prod: set `LLM_MODE=live` +
`LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` (mis. base URL
`https://open.bigmodel.cn/api/paas/v4` — API OpenAI-compatible); biaya tetap
nol di dev karena default `mock`.

### Metrik & event aktivasi (Sprint 3)

- Gate metrik PRD §8 dimulai: setiap scan PERTAMA seorang user mencatat event
  `scan_pertama` ke tabel `analytics_events` (append-only — hanya INSERT),
  ikut transaksi scan yang sama (tidak ada event "hantu" bila request gagal).
  Payload: `{scan_id, category, points}`; juga dilog sebagai
  `EVENT scan_pertama user=… scan=…`.
- `services/metrics.track_event()` adalah pintu masuk tunggal; event berikutnya
  (`misi_selesai`, `modul_selesai`, `streak_hari`) memakai fungsi yang sama di
  sprint masing-masing.
- Angka penghitung cache (`scan:stats:*`) diekspos ke admin lewat
  `GET /v1/admin/kpi` (`cache.hit_rate`) sebagai dasar metrik hit rate ≥70%.

### Misi: klaim & data (Sprint 4)

- **Periode anti dobel**: `UNIQUE(user_id, mission_id, period_date)` (skema awal)
  + `period_date` dihitung server (`services/missions.period_date_for`):
  `daily`/`special` → hari ini; `weekly` → Senin pekan berjalan. `period_date`
  tidak pernah NULL (NULL lolos UNIQUE di Postgres).
- **Consent foto bukti (keputusan §2.1 #6)**: klaim photo menuntut `consent=true`;
  waktu persetujuan dicatat server-side di `user_missions.consent_at` (bukan hanya
  localStorage perangkat). Foto bukti disimpan `UPLOAD_DIR/missions/` (dilayani
  `/uploads`), hanya ditampilkan ke verifier/admin (layar verifikasi Sprint 5);
  penggantian bukti setelah penolakan menghapus berkas lama dari disk. Retensi:
  bukti hidup selama baris klaim ada; penghapusan atas permintaan lewat support
  (proses manual MVP) — kebijakan TTL otomatis ditinjau Sprint 8 dgn keputusan PO.
- **Poin misi tidak diberikan saat klaim** — ledger hanya disentuh saat approval
  (Sprint 5), sehingga antrian `pending` tidak mengubah `users.points`.
- **Biaya LLM**: dashboard menjumlahkan `llm_meta.tokens.total_tokens` baris
  scan non-cache bulan berjalan (baris cache menyalin meta panggilan asli —
  agar tidak dihitung ganda) × `LLM_COST_PER_1K_TOKENS`; mock mode = Rp0.

## Middleware audit log

- Mencatat POST/PUT/PATCH/DELETE (kecuali `/health` dan seluruh `/v1/auth/*` —
  auth diaudit eksplisit di endpoint) ke `audit_logs`: `actor_id` (dari JWT bila
  valid), `action` (`post:/v1/missions`), `entity`, `entity_id`, `diff`.
- Kegagalan penulisan audit tidak menggagalkan request (log warning).

## Seed data

`uv run python -m scripts.seed` (idempoten): 7 `waste_categories`
(Organik, Plastik, Kertas, Kaca, Logam, B3, Residu — dgn icon & `base_points`),
10 `levels` (0 → 2.300 poin: Pemula s.d. Teladan Ekoteologi), 10 `badges`
(kriteria JSONB `{"type","value"}` — dievaluasi badge engine Sprint 6), dan
5 `missions` contoh (photo ×2, manual ×2, auto_scan ×1 — Sprint 4; admin bisa
mengelola lewat CRUD `/v1/admin/missions`).

## Test

```bash
uv run pytest          # skema test DB disiapkan otomatis (alembic upgrade via subprocess)
uv run ruff check .
uv run ruff format --check .

# Coverage (gate ≥70% — DoD §1.4); sama dengan `make api-cov`:
uv run pytest -q --cov=app --cov-report=term-missing --cov-fail-under=70
```

> Catatan pengukuran: pytest-cov di lingkungan ini **kekurangan-lapor** sebagian
> baris body endpoint async (teramati juga pada `auth.py` sejak Sprint 1 —
> frame setelah `await` di tengah request kadang tidak tercatat oleh ketiga
> tracer core). Angka yang ditampilkan adalah batas bawah; total tetap 88%
> (gate 70% lolos), modul Sprint 2 (ledger, llm, quotes, cache, limit) 89–100%.
