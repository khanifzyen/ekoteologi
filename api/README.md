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
| `PUSH_MODE` | `log` | Pengirim push (Sprint 6): `log` (dev/test — push dicatat di log, tanpa kredensial) atau `fcm` |
| `FCM_CREDENTIALS_FILE` / `FCM_PROJECT_ID` | kosong | JSON service account (permission `firebase.messaging`) + project id — wajib utk `PUSH_MODE=fcm`; tanpa keduanya fallback ke log |

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
| GET | `/v1/profile` | Bearer | Profil + level dari **level engine** (`services/levels`) — `level`, `level_title`, `next_level*` (sisa poin/progres menuju level berikutnya), `current_streak`, `longest_streak` (PRD §5.10 #2: level tidak disimpan) |
| PATCH | `/v1/profile` | Bearer | Ubah `full_name`/`city`/`avatar_url` |
| POST | `/v1/profile/avatar` | Bearer | Multipart `file` (JPG/PNG/WebP, ≤2 MB) → simpan di `UPLOAD_DIR`, `avatar_url` relatif `/uploads/avatars/…` |
| POST | `/v1/scan` | Bearer | Multipart `file` foto (JPG/PNG/WebP, ≤`SCAN_IMAGE_MAX_MB`) → hasil analisis LLM tervalidasi (lihat "Arsitektur Scan AI"). 400/413 foto tidak valid, 429 kuota harian habis (+ header `Retry-After`), 503 Redis mati (fail-closed), 502 LLM gagal setelah retry+fallback |
| GET | `/v1/scans` | Bearer | Riwayat scan milik user, terbaru dulu. Query: `category_id?`, `limit` (1–50, default 20), `offset` → `{items, total, limit, offset}` |
| GET | `/v1/scans/categories` | — | Daftar kategori sampah (seed) utk filter chips — `{id, name, icon, base_points}` |
| GET | `/v1/scans/quota` | Bearer | Pemakaian kuota hari ini tanpa mengkonsumsi slot → `{used, limit, remaining, resets_in_seconds}`. Redis mati → 503 (UI menyembunyikan pill kuota) |
| GET | `/v1/missions` | Bearer | Daftar misi aktif dalam jendela periode + klaim saya periode berjalan (`my_claim`) + ringkasan mingguan (`{week_done, week_total, week_points}`) |
| POST | `/v1/missions/{id}/claim` | Bearer | Klaim misi **photo**: multipart `file` bukti (JPG/PNG/WebP, ≤`MISSION_IMAGE_MAX_MB`) + `consent=true` (wajib — PRD §9, tercatat di `user_missions.consent_at`) → status `pending` (antrian verifikasi). Klaim misi **manual** (Sprint 5): tanpa file/consent → auto-approve, poin langsung lewat ledger, event `misi_selesai` + streak berdetak. Misi **auto_scan** tidak diklaim (400) — progresnya dari scan. 409 misi nonaktif/di luar periode/sudah diklaim periode ini; 400 tanpa consent/format salah; 413 ukuran. Bukti yang **ditolak** boleh diganti (baris sama di-reset) |
| GET | `/v1/streak` | Bearer | Status streak harian (Sprint 5): `{current_streak (efektif), longest_streak, active_today, last_active_date, bonus_points, bonus_every_days, days_to_bonus, week[7]}` — kalender 7 hari dibangun dari tanggal baris ledger (baca saja; aktivitas dicatat lewat scan bernilai poin / klaim manual / approve) |
| GET | `/v1/notifications` | Bearer | Notifikasi in-app milik user (terbaru dulu) + `unread_count` utk badge. Query: `type?` (mission\|streak\|info\|reward), `unread_only?`, `limit`, `offset` |
| POST | `/v1/notifications/read` | Bearer | Tandai semua (atau `{ids}` tertentu) notifikasi milik user sebagai dibaca — idempoten |
| POST | `/v1/notifications/{id}/read` | Bearer | Tandai satu notifikasi dibaca; 404 bila milik user lain |
| GET | `/v1/badges` | Bearer | Lencana + flag `earned`/`earned_at` milik user (tab Pencapaian). **Badge engine (Sprint 6)**: sebelum daftar dikirim, kriteria JSONB dievaluasi lazy — lencana yang layak diberikan + dinotifikasikan (`type=info`); evaluasi on-event juga jalan di momen poin masuk (scan bernilai poin, approve/klaim manual misi) |
| GET | `/v1/leaderboard` | Bearer | Papan peringkat MVP (Sprint 6 — backend saja; UI penuh fase 2): top-N `users.points` (index, PRD §5.10 #7) dgn `rank` (window RANK — poin sama = rank sama), `level`/`level_title`, `me` (posisi pemohon walau di luar jendela), `total`. Query: `limit` (1–100, default 20). Hanya pengguna aktif berpoin > 0; PII minimal |
| GET | `/v1/daily-content` | Bearer | Kartu "Kutipan Hari Ini" `beranda.html` (Sprint 6): konten terjadwal admin hari ini (`daily_contents.publish_date`) atau fallback rotasi bank quote terkurasi (`fallback: true`, tanpa `eco_action`) — selalu 200 |
| POST | `/v1/push/token` | Bearer | Daftarkan token FCM perangkat `{token, platform?}` → `fcm_tokens` (upsert idempoten; token akun lain berpindah ke akun ini). Token <32 karakter → 400 |
| DELETE | `/v1/push/token` | Bearer | Hapus token milik sendiri `{token}` (logout/uninstall) — idempoten |
| GET | `/v1/modules` | Bearer | Daftar modul **tayang** (urut `order`) + progres saya per modul (`lessons_done/total`, `percent`, `is_completed`, CTA `Mulai/Lanjutkan/Ulangi`) + `summary {completed,total}` utk chip header "N/M modul" |
| GET | `/v1/modules/{id}` | Bearer | Detail modul: daftar pelajaran (flag `done`), intro kuis (`question_count`, `pass_percent`, `points`, bank soal **tanpa kunci jawaban**), `quiz_best` (hasil kuis terbaik saya) |
| GET | `/v1/lessons/{id}` | Bearer | Satu pelajaran: blok konten JSONB (`paragraph` / `quote` arab+terjemah+sumber / `tip`) + `next_lesson_id` utk CTA lanjut |
| POST | `/v1/lessons/{id}/complete` | Bearer | Tandai pelajaran selesai — progres berurutan `lessons_done = max(order+1)` (baca ulang tidak menurunkan). Pelajaran terakhir = modul tuntas → event `modul_selesai` + streak + evaluasi lencana (sekali, idempoten). Tanpa poin — poin hanya kuis |
| GET | `/v1/modules/{id}/quiz` | Bearer | Intro kuis + bank soal tanpa kunci jawaban. 404 bila modul belum punya kuis/soal |
| POST | `/v1/modules/{id}/quiz` | Bearer | Kirim `{answers: [{question_id, choice}]}` → **penilaian otomatis server**: `{score, total, percent, passed, points_awarded, points_total, already_passed_before, message, review[]}` (kunci + penjelasan terbuka SETELAH submit). Lulus → poin `QUIZ_POINTS` lewat ledger **sekali per modul** (kuis ulang = 0 poin), notifikasi, event `modul_selesai`, streak, badge engine on-event. Gagal → attempt tersimpan tanpa poin |
| GET | `/v1/admin/kpi` | Bearer panel | KPI dashboard read-only → `{users, scans, verification:{pending}, cache:{hit,miss,hit_rate}, llm:{cost_month, tokens_month, budget_monthly}}` — biaya LLM = token bulan berjalan (scan non-cache) × `LLM_COST_PER_1K_TOKENS` |
| GET | `/v1/admin/charts` | Bearer panel | Data 2 chart dashboard: `daily` (scan/hari `days`=7–30, default 14, hari kosong = 0) & `categories` (7 hari, terbanyak dulu, persentase) |
| GET | `/v1/admin/missions` | Bearer panel | Daftar misi + rekap klaim (`claims_total`, `claims_pending`). Query: `is_active?`, `verification?`, `q?` (judul), `limit` (1–100), `offset` |
| POST | `/v1/admin/missions` | Bearer admin·editor | Buat misi `{title, description?, type: daily\|weekly\|special, icon?, points, verification: photo\|auto_scan\|manual, scan_category_id? (wajib utk auto_scan), required_count?, start_at?, end_at?, is_active?}` → 201. Validasi: `start_at < end_at`, kategori harus ada |
| PATCH | `/v1/admin/missions/{id}` | Bearer admin·editor | Ubah sebagian field misi (termasuk `is_active` utk nonaktifkan) |
| DELETE | `/v1/admin/missions/{id}` | Bearer admin | Hapus misi; 409 bila sudah punya klaim (nonaktifkan saja — jaga riwayat) |
| GET | `/v1/admin/claims` | Bearer panel | Antrian klaim (`user_missions` + user + misi, terbaru dulu) + `user_claims_total` (konteks "Sejarah" layar verifikasi). Query: `status?`, `mission_id?`, `limit`, `offset` |
| POST | `/v1/admin/claims/{id}/review` | Bearer admin·verifier | Keputusan verifikasi (Sprint 5): `{decision: approved\|rejected, note?}`. Approve → poin misi lewat ledger + notifikasi in-app + event `misi_selesai` + streak user berdetak (satu transaksi). Reject → `note` **wajib** (400 tanpa catatan), tanpa poin. 409 bila klaim sudah direview. Tercatat di audit log |
| GET | `/v1/admin/users` | Bearer panel | Daftar pengguna (+level dihitung dari `levels`). Query: `q?` (nama/email/kota), `role?`, `status?` (active\|blocked), `limit`, `offset` |
| GET | `/v1/admin/contents` | Bearer panel | Daftar konten harian (terdekat dulu). Query: `schedule?` (upcoming\|published), `limit`, `offset` |
| POST | `/v1/admin/contents` | Bearer admin·editor | Jadwalkan konten harian `{publish_date, type: ayat\|hadis\|refleksi, body, title?, source?, eco_action?, image_url?}` → 201. `publish_date` UNIQUE → 409 bila tanggal sudah terisi |
| PATCH | `/v1/admin/contents/{id}` | Bearer admin·editor | Ubah isi / geser jadwal (deteksi bentrok tanggal → 409) |
| DELETE | `/v1/admin/contents/{id}` | Bearer admin | Hapus konten |
| GET | `/v1/admin/modules` | Bearer panel | Daftar SEMUA modul (termasuk draft) + rekap `lesson_count`/`question_count` |
| POST | `/v1/admin/modules` | Bearer admin·editor | Buat modul `{title, slug?, description?, cover_url?, order, is_published}` → 201; slug kosong = otomatis dari judul (bentrok → suffix `-2`); slug eksplisit bentrok → 409 |
| PATCH | `/v1/admin/modules/{id}` | Bearer admin·editor | Ubah sebagian field modul (judul/slug/deskripsi/ikon/urutan/tayang) |
| DELETE | `/v1/admin/modules/{id}` | Bearer admin | Hapus modul; **409 bila sudah ada progres/attempt pengguna** (riwayat belajar terjaga — nonaktifkan saja) |
| GET | `/v1/admin/modules/{id}/lessons` | Bearer panel | Pelajaran modul (urut) dgn blok penuh — bahan editor admin |
| POST | `/v1/admin/modules/{id}/lessons` | Bearer admin·editor | Tambah pelajaran `{title, blocks[], order?}` — blok JSONB tervalidasi (`paragraph`/`quote`/`tip`; blok invalid → 400 dgn pesan blok ke-N) |
| PATCH | `/v1/admin/lessons/{id}` | Bearer admin·editor | Ubah judul/blok/urutan pelajaran |
| DELETE | `/v1/admin/lessons/{id}` | Bearer admin | Hapus pelajaran |
| GET | `/v1/admin/modules/{id}/questions` | Bearer panel | Bank soal modul (kunci jawaban ikut — panel admin) |
| POST | `/v1/admin/modules/{id}/questions` | Bearer admin·editor | Tambah soal `{question, options[2–6], answer, explanation?, order?}` → kuis per modul dibuat otomatis saat soal pertama; opsi <2 atau kunci di luar jangkauan → 400 |
| PATCH | `/v1/admin/questions/{id}` | Bearer admin·editor | Ubah soal/opsi/kunci/penjelasan/urutan |
| DELETE | `/v1/admin/questions/{id}` | Bearer admin | Hapus soal |
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
  `/uploads`), hanya ditampilkan ke verifier/admin (layar verifikasi);
  penggantian bukti setelah penolakan menghapus berkas lama dari disk. Retensi:
  bukti hidup selama baris klaim ada; penghapusan atas permintaan lewat support
  (proses manual MVP) — kebijakan TTL otomatis ditinjau Sprint 8 dgn keputusan PO.
- **Poin misi tidak diberikan saat klaim** — ledger hanya disentuh saat approval,
  sehingga antrian `pending` tidak mengubah `users.points`.
- **Biaya LLM**: dashboard menjumlahkan `llm_meta.tokens.total_tokens` baris
  scan non-cache bulan berjalan (baris cache menyalin meta panggilan asli —
  agar tidak dihitung ganda) × `LLM_COST_PER_1K_TOKENS`; mock mode = Rp0.

### Verifikasi, level, streak, notifikasi (Sprint 5)

- **Loop verifikasi tertutup** (`POST /v1/admin/claims/{id}/review`, role
  admin/verifier): approve → `award_points(source="mission")` (ledger
  append-only + sinkron `users.points`), notifikasi in-app "Misi disetujui!",
  event `misi_selesai` (PRD §8), streak user berdetak — semuanya satu
  transaksi. Reject → `note` wajib (400 bila kosong), notifikasi memuat
  catatan, tanpa poin, dan user boleh mengunggah ulang bukti (baris sama
  di-reset). Keputusan tercatat di audit log via middleware.
- **Level engine** (`services/levels.py`, murni): level = entri tertinggi
  `levels.min_points <= users.points`; level tidak pernah disimpan (PRD
  §5.10 #2). Satu sumber untuk profil, admin users, dan respons review;
  menghasilkan `next_level*` untuk UI progres.
- **Streak harian** (`services/streak.py`): aktivitas = scan bernilai poin
  (bukan duplikat), klaim manual, dan misi yang disetujui — semuanya menulis
  ledger. `touch_streak` idempoten per hari; bolong ≥2 hari → tampil 0 dan
  reset ke 1 saat aktif lagi (lazy, tanpa cron). Bonus +`STREAK_BONUS_POINTS`
  (20) tiap kelipatan `STREAK_BONUS_EVERY_DAYS` (6 — mengikuti mockup
  `beranda.html`: "Streak 5 hari! … 1 hari lagi untuk bonus +20 poin"),
  lewat ledger `source="streak"` + notifikasi; event `streak_hari` tercatat
  tiap hari aktif baru. `GET /v1/streak` membaca status + kalender 7 hari dari
  tanggal baris ledger.
- **Misi auto_scan**: tiap scan bernilai poin menaikkan `progress_count`
  misi auto_scan aktif (filter `scan_category_id` bila diisi); baris
  `user_missions` dibuat lazily (`in_progress`) dgn SAVEPOINT anti race.
  Target `required_count` tercapai → approve otomatis (poin + notifikasi +
  event), pola sama dgn approve verifier.
- **Notifikasi in-app** (`notifications`, PRD §5.9): hasil verifikasi,
  misi auto_scan selesai, bonus streak, dan poin klaim manual. Endpoint
  list + tandai dibaca (satu/semua); `unread_count` untuk badge. Baris
  yang sama menjadi sumber push FCM (Sprint 6).

## Gamifikasi & push (Sprint 6)

- **Badge engine** (`services/badges.py`): kriteria JSONB
  `{"type","value"}` → dievaluasi terhadap statistik user (`scan_count`
  = scan bernilai poin, `mission_done` = klaim approved, `streak` =
  rekor `longest_streak`, `points_earned` = SUM ledger, `quiz_passed`
  = kuis lulus — aktif saat e-learning hidup Sprint 7). Strategi
  **hybrid on-event + lazy**: `sync_user_badges()` dipanggil di momen
  poin masuk (scan, approve/klaim manual — notifikasi langsung) DAN di
  `GET /v1/badges` (backfill; idempoten). Kriteria korup/tidak dikenal →
  fail-closed (tidak pernah terberi karena data rusak).
- **Leaderboard MVP** (`GET /v1/leaderboard`): index `users.points`
  (PRD §5.10 #7), `RANK() OVER (ORDER BY points DESC)` — poin sama =
  rank sama; `me` selalu tersedia. Backend saja; UI penuh fase 2.
- **Push FCM** (`services/push.py`, `api/push.py`): token perangkat
  disimpan di `fcm_tokens` (`POST/DELETE /v1/push/token`). Abstraksi
  `PushSender`: `LogPushSender` (default — push dicatat di log, tanpa
  kredensial) & `FcmHttpV1Sender` (kerangka FCM HTTP v1 — aktif bila
  `PUSH_MODE=fcm` + `FCM_CREDENTIALS_FILE` + `FCM_PROJECT_ID`; fallback
  otomatis ke log bila konfigurasi kurang). `push_notification()` best-
  effort setelah commit di review misi — **pengiriman nyata menunggu
  kredensial service account** (item terbuka, plan §2.2).
- **Konten harian** (`daily_contents`, PRD §5.6): CRUD admin
  (`/v1/admin/contents`) — penjadwalan = `publish_date` (UNIQUE, satu
  konten/hari; tanpa cron, konsisten pola streak). Mobile: `GET
  /v1/daily-content` → konten hari ini, atau fallback rotasi
  deterministik bank quote terkurasi (`services/quotes.py`, sumber yang
  sama dgn scan) — kartu wisdom beranda tidak pernah kosong.
- **Profil +statistik dampak**: `GET /v1/profile` kini memuat
  `scans_total` (scan bernilai poin), `missions_approved`, `badges_earned`,
  `level_progress` (%) — bahan kartu "Pohon Kebaikanmu" beranda & layar
  profil (tahap pohon dihitung di klien dari angka server).

## E-Learning & konten harian (Sprint 7)

- **Modul → pelajaran → kuis** (PRD §5.5/§2.4): blok konten pelajaran berbentuk
  JSONB tervalidasi `normalize_blocks()` — `paragraph {text}`, `quote
  {text, arabic?, source?}`, `tip {text}` (mockup `elearning.html`).
- **Progres berurutan**: `user_module_progress.lessons_done = max(tercatat,
  order+1)`; bar progres kartu modul = persen dari total pelajaran. Pelajaran
  terakhir → `is_completed` + event `modul_selesai` (source=pelajaran) +
  streak + badge engine (sekali — transisi idempoten).
- **Kuis otomatis + anti dobel poin**: kunci jawaban tidak pernah dikirim
  sebelum submit. Lulus (persen ≥ `QUIZ_PASS_PERCENT`) → attempt `passed=true`
  + poin `QUIZ_POINTS` via `award_points(source="quiz")` **sekali per modul**
  (lulus ulang tercatat tapi 0 poin), notifikasi "Poin kuis masuk", event
  `modul_selesai` (source=kuis), streak, dan `sync_user_badges` on-event
  (lencana kriteria `quiz_passed` — mis. "Cendekiawan Hijau" — terbuka
  otomatis). Gagal → attempt tersimpan (riwayat) tanpa poin.
- **Konten harian mobile**: layar Belajar menampilkan kartu "Refleksi Hari
  Ini" dari endpoint yang sama dgn beranda (`GET /v1/daily-content`) — satu
  sumber (jadwal admin atau fallback bank quote), tanpa duplikasi.
- **Env baru**: `QUIZ_PASS_PERCENT` (70), `QUIZ_POINTS` (20) — ambang &
  hadiah bisa diubah PO tanpa deploy.

## Middleware audit log

- Mencatat POST/PUT/PATCH/DELETE (kecuali `/health` dan seluruh `/v1/auth/*` —
  auth diaudit eksplisit di endpoint) ke `audit_logs`: `actor_id` (dari JWT bila
  valid), `action` (`post:/v1/missions`), `entity`, `entity_id`, `diff`.
- Kegagalan penulisan audit tidak menggagalkan request (log warning).

## Seed data

`uv run python -m scripts.seed` (idempoten): 7 `waste_categories`
(Organik, Plastik, Kertas, Kaca, Logam, B3, Residu — dgn icon & `base_points`),
10 `levels` (0 → 2.300 poin: Pemula s.d. Teladan Ekoteologi), 10 `badges`
(kriteria JSONB `{"type","value"}` — dievaluasi badge engine Sprint 6), 5
`missions` contoh (photo ×2, manual ×2, auto_scan ×1 — Sprint 4; admin bisa
mengelola lewat CRUD `/v1/admin/missions`), dan 3 modul e-learning contoh
(Sprint 7, mengikuti mockup `elearning.html`): "Eko-Iman: Dasar Ekoteologi",
"Fiqih Sampah Sehari-hari", dan "Hemat Air, Amal Terjaga" — lengkap pelajaran
(blok paragraph/quote/tip) + bank soal kuis agar demo belajar → kuis → poin
jalan end-to-end. Idempoten per slug/judul pelajaran/teks soal.
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
