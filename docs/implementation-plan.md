# Implementation Plan — Ekoteologi AR (Scrum)

> **Revisi 2 (10 Sep 2026) — backend FastAPI → PocketBase.**
> Sprint 0–8 (MVP) **sudah dieksekusi dengan FastAPI** (laporan: `docs/sprint/sprint-0.md` …
> `sprint-8.md`, CI hijau). Rencana berikut mengganti backend menjadi **PocketBase** dan
> mengelompokkan ulang seluruh pekerjaan migrasi ke **Sprint 9–13**. Aplikasi admin & mobile
> (Vue) tetap dipakai — hanya lapisan API client-nya yang diganti.
>
> Timeline migrasi: 5 sprint × 2 minggu ≈ 10 minggu. Velocity asumsi tetap 11–13 poin/sprint.

---

## 1. Kerangka Scrum

### 1.1 Tim (usulan)

| Peran | Jumlah | Fokus |
|---|---|---|
| Product Owner | 1 | Prioritas backlog, keputusan PRD §6, demo review |
| Scrum Master | 1 (bisa rangkap PO) | Proses, blocker |
| Backend Dev (PocketBase/JSVM) | 1 | Skema koleksi, API rules, hooks, migrasi data, integrasi LLM & FCM |
| Frontend Dev Mobile (Vue + Capacitor) | 1 | User app Android + swap SDK PocketBase |
| Frontend Dev Admin (Vue) | 1 (bisa digabung dgn mobile) | Panel admin + swap SDK PocketBase |
| QA Engineer | 1 | Test plan, device matrix, regresi migrasi |

### 1.2 Ceremoni & ritme (sprint = 2 minggu)

| Acara | Kapan | Output |
|---|---|---|
| Sprint Planning | Hari 1 pagi | Sprint goal + komitmen story |
| Daily Standup | Tiap hari, 15 menit | Sinkron blocker |
| Backlog Refinement | Minggu ke-2, 1× | Story sprint berikutnya siap (DoR) |
| Sprint Review + Demo | Hari terakhir | Demo perangkat asli + keputusan PO |
| Retrospective | Setelah review | 1–2 perbaikan proses |

### 1.3 Definition of Ready (DoR) — story boleh masuk sprint jika:

- Acceptance criteria tertulis & terukur.
- Ada referensi desain (`docs/desain/…`) ATAU dinyatakan "tanpa UI".
- Dependensi API/data sudah diidentifikasi (nama koleksi / route hook minimal).
- Estimasi poin sudah disepakati tim.

### 1.4 Definition of Done (DoD) — semua story

- [ ] Kode review disetujui (≥1 reviewer), CI hijau (lint + test + build).
- [ ] Logika bisnis (poin, verifikasi, kuis) tercover test integrasi HTTP terhadap instance
      PocketBase uji (alur kritis: scan→poin, klaim→verifikasi→poin, kuis→lulus); unit test
      admin/mobile tetap Vitest.
- [ ] Implementasi UI 100% dari `tokens.css` — nol hardcode warna/jarak (rujukan audit:
      `docs/desain/AUDIT.md`).
- [ ] State lengkap: loading (skeleton), empty, error, offline bila layar data.
- [ ] Aksesibilitas: tap target ≥44px, kontras AA, `prefers-reduced-motion`, focus-visible.
- [ ] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata (mobile) / Chrome+Firefox (admin).
- [ ] Terdokumentasi (README modul / daftar koleksi + route hook).

### 1.5 Estimasi

Mapping poin: **S = 1, M = 3, L = 5**. Velocity **11–13 poin/sprint**. Total backlog migrasi
PocketBase: **±63 poin → 5 sprint (Sprint 9–13)**.

---

## 2. Keputusan & Prasyarat Migrasi

### 2.1 Keputusan yang wajib ditutup sebelum Sprint 9

| # | Keputusan | Deadline | Blokir |
|---|---|---|---|
| M1 | Pin versi PocketBase (rekomendasi: seri **v0.40.x**, pre-1.0 → wajib baca changelog tiap upgrade) | Sebelum Sprint 9 | Semua |
| M2 | Strategi ekstensi: **JS-only via JSVM** (`pb_hooks`) vs extension Go (fallback khusus push, lihat risiko R4) | Sebelum Sprint 11 | Scan AI & FCM |
| M3 | Hosting backend: single binary PocketBase di VPS / Fly.io / Railway + volume `pb_data` | Sebelum Sprint 9 | Deploy staging |
| M4 | Cut-over data: migrasi data dev/staging lama (Postgres → SQLite) via skrip sekali pakai, atau mulai bersih | Sebelum Sprint 12 | Verifikasi & gamifikasi |
| M5 | LLM live memakai **9Router** self-hosted di VPS — `LLM_BASE_URL=http://127.0.0.1:20128/v1` (OpenAI-compatible, **sudah terpasang**); mock mode tetap untuk dev/test | ✅ Ditutup 10 Sep 2026 | Sprint 11 |

Keputusan PRD yang sudah final dan **tetap berlaku**: scope respons LLM, rate limit scan
(kini proteksi beban 9Router — bukan budget API), consent privasi foto bukti + retensi,
bahasa Indonesia saja, reward digital fase 2, verifikasi per kolom `missions.verification`.

### 2.2 Akun & akses

- LLM: **9Router self-hosted di VPS** (sudah terpasang) — hook scan memanggil
  `http://127.0.0.1:20128/v1` (env `LLM_BASE_URL`) + `LLM_MODEL`/`LLM_FALLBACK_MODEL`;
  tanpa API key eksternal, 9Router tidak terekspos publik. Mock mode tetap default dev/test.
- Google Cloud: client OAuth untuk PocketBase (provider Google) + **service account JSON FCM**
  (dibaca dari env/file oleh hook push).
- Play Console (internal testing), Sentry project — **tetap**.
- Domain + SSL untuk PocketBase & admin (reverse proxy Caddy/Nginx).

---

## 3. Dampak Perubahan Backend: FastAPI → PocketBase

### 3.1 Peta penggantian komponen

| Peran di FastAPI (sekarang) | Ganti dengan (PocketBase) | Catatan |
|---|---|---|
| 22 modul router (`app/api/*`) | API koleksi bawaan + **custom route di `pb_hooks/*.pb.js`** (JSVM) | CRUD standar (misi, modul, konten) tidak butuh kode; hanya logika bisnis jadi hook |
| SQLAlchemy 2 async + PostgreSQL 16 | Koleksi SQLite embedded (satu file `pb_data/`) | Relasi & index lewat migration; skema di-port dari model `app/models/*` |
| Alembic migrations | `pb_migrations/*.pb.js` (ikut repo, jalan otomatis) | Seed data (kategori, level, badge) juga jadi migration |
| Redis (cache scan, rate limit) | **Redis dihapus**: koleksi `llm_cache` + cache in-memory hooks; rate limit bawaan PB (settings) + counter koleksi untuk limit harian per user | |
| Auth JWT manual (PyJWT, bcrypt, refresh) | Auth collection bawaan (hash, token, refresh) + **OAuth2 Google bawaan** | Kode `core/security.py`, `services/google.py` pensiun |
| Pydantic schemas (`app/schemas/*`) | Skema field koleksi + validasi di hook (`onRecordCreateRequest`, dsb.) | Kontrak respons LLM tetap divalidasi manual di hook scan |
| OpenAPI otomatis + generated client | JS SDK **`pocketbase`** di admin & mobile + typed helper tipis | Tidak ada `/docs` Swagger; kontrak didokumentasikan di `pocketbase/README.md` |
| Middleware audit log / security header | Hook `onRecordAfter*` → koleksi `audit_logs`; security header default PB + reverse proxy | |
| Scheduler (`services/scheduler.py`) | `cronAdd(...)` di hooks | Streak reminder, publish konten harian, backup |
| FCM (`services/push.py`, `broadcast.py`) | Hook `$http.send` → FCM HTTP v1 (token OAuth service account, di-cache) | Lihat risiko R4 (signing RS256 di JSVM) |
| Sentry `sentry-sdk[fastapi]` | Hook error reporter (`onError` → kirim ke Sentry via HTTP) atau PB logs; Sentry mobile tetap | |
| pytest + coverage ≥70% | Uji integrasi HTTP terhadap instance PB uji (skrip Node/Vitest) + lint hooks | Frontend tetap Vitest |

### 3.2 Yang tetap dipakai (tidak berubah)

- **Admin** Vue 3 + Vite + TS (Pinia, Router) — UI verifikasi, composer, dashboard, editor blok.
- **Mobile** Vue 3 + Vite + TS + Capacitor 8 — semua layar, desain, `tokens.css`, FontAwesome.
- CI job `admin`, `mobile`, `android-apk` (lint/test/build/APK).
- Konsep domain: poin = **ledger append-only** (`point_transactions`), `users.points` hanya
  cache; anti dobel klaim per `(user, mission, period_date)`; kriteria badge JSON; kuis
  anti dobel poin sekali per modul.
- Setup FCM, Play Store, desain & mockup, PRD/DESIGN.

### 3.3 Artefak repo yang perlu diupdate

| Artefak | Perubahan |
|---|---|
| `api/` (FastAPI) | Dipensiunkan: tag/arsipkan (`fastapi-archive`) lalu hapus dari `master`; riwayat tetap di git |
| `pocketbase/` (baru) | `pb_migrations/` (skema + seed), `pb_hooks/` (route + logika), `README.md` (kontrak API), `.env.example`, binary `pb_data/` di-gitignore |
| `docker-compose.yml` | Hapus service `db` + `redis`; tambah service `pocketbase` (volume `pb_data`) — atau jalankan binary langsung di host |
| `Makefile` | Target `api-*` → `pb-serve`, `pb-superuser`, `pb-test`, `pb-smoke`; hapus `api-migrate`/`api-seed` (migration jalan sendiri) |
| `.github/workflows/ci.yml` | Job `api` (uv + Postgres/Redis service) → job `backend` (unduh binary PB versi pin, jalankan instance uji, smoke endpoint, lint JS) |
| `README.md` root + README per app | Stack, quickstart (`./pocketbase serve`), konvensi env |
| `admin/src` — lapisan API | Ganti fetch client custom → SDK `pocketbase`; auth store (token + refresh otomatis); URL file (`getFileUrl`) |
| `mobile/src` — lapisan API | Sama + alur OAuth2 Google via Capacitor + **subscribe realtime** (SSE) untuk notifikasi |
| `.env.example` | `POCKETBASE_URL` menggantikan `DATABASE_URL`/`REDIS_URL`; env LLM (`LLM_BASE_URL` → 9Router, `LLM_MODEL`, `LLM_FALLBACK_MODEL`) & `FCM_*` tetap |
| `docs/PRD.md` §5 | Sync tech stack (di luar dokumen ini — dicatat untuk PO) |

### 3.4 Konsekuensi & trade-off yang disetujui

- **SQLite single-node**: konkurensi tulis lebih terbatas dari Postgres — cukup untuk skala
  MVP; scaling = scale-up satu instance (bukan replika DB).
- **Pre-1.0**: versi di-pin; ada breaking change antar minor → upgrade terjadwal + smoke CI.
- **JSVM (goja)**: JS di hooks tanpa API Node & tanpa npm — port layanan Python → JS ditulis
  manual, tidak bisa impor library backend.
- **Tanpa OpenAPI otomatis**: kontrak API = skema koleksi + daftar route hook; wajib
  didokumentasikan.
- **Admin UI bawaan PocketBase** = bonus untuk superuser (kelola data mentah), tetapi panel
  admin Vue tetap dipertahankan untuk alur khusus (verifikasi, composer, dashboard).

---

## 4. Ringkasan Backlog Migrasi

| Epic | Isi | Poin | Sprint |
|---|---|---|---|
| B1 Fondasi PocketBase | Scaffold, port skema → koleksi, API rules, seed, infra & CI | 13 | 9 |
| B2 Auth & integrasi klien | Auth + Google OAuth, profil, swap SDK admin & mobile, rate limit, audit | 12 | 10 |
| B3 Scan AI | Custom route scan, adapter LLM di JSVM, cache, ledger, riwayat | 13 | 11 |
| B4 Misi & gamifikasi | CRUD misi, klaim + verifikasi, anti dobel, level, streak, badge | 13 | 12 |
| B5 E-learning, notif, rilis | Modul + kuis, konten harian, notif realtime + FCM, hardening, QA, rilis | 12 | 13 |
| **Total** | | **63** | 9–13 |

> Backlog Fase 2 (leaderboard agregat, komunitas, peta, reward, PWA offline penuh — PRD §6/§7
> Epic 7) tidak diestimasi; di-refine menjelang Sprint 13.

---

## 5. Sprint Plan Migrasi

> Setiap sprint punya **Goal** dan **Demo**. Acuan desain tetap `docs/desain/` — UI tidak
> berubah, hanya sumber datanya.

### Sprint 9 — Fondasi PocketBase (13 poin)

**Goal:** PocketBase jalan lokal + staging, seluruh skema ter-port jadi koleksi, admin Vue
sudah login via PocketBase.

| Story | Poin | Catatan |
|---|---|---|
| Scaffold `pocketbase/` (binary pin v0.40.x, `pb_hooks/`, `pb_migrations/`, `pb_data` gitignore, superuser init, `.env.example`) | 2 | Ganti direktori `api/` (arsip tag `fastapi-archive`) |
| Port skema: semua model SQLAlchemy (`app/models/*`) → koleksi + relasi + index via `pb_migrations` | 5 | `users` jadi auth collection; sisanya koleksi biasa |
| API rules: role user/admin, ownership (`@request.auth.id`), default deny | 2 | Pengganti `core/deps.require_roles` |
| Seed data awal (kategori sampah, levels, badges) sebagai migration — idempoten | 1 | Pengganti `scripts/seed` |
| Infra: docker-compose (hapus Postgres+Redis → service `pocketbase`), Makefile `pb-*`, README | 2 | |
| CI: job `api` → `backend` (unduh PB binary versi pin, jalankan instance uji, smoke `/api/health`, lint JS hooks) | 1 | |

**Demo:** Login admin Vue via PocketBase; daftar koleksi sesuai skema lama di Dashboard PB;
CI hijau job `backend`.

### Sprint 10 — Auth, Profil & Swap SDK Klien (12 poin)

**Goal:** Seluruh panggilan API admin & mobile sudah lewat SDK PocketBase; alur
daftar → masuk → beranda jalan di perangkat.

| Story | Poin | Catatan |
|---|---|---|
| Mobile: auth email+password via PB SDK (register, login, token persist, logout) | 2 | `mobile/auth.html` |
| Google Sign-In native (Capacitor) → OAuth2 provider Google PocketBase (system browser / `authWithOAuth2Code`) | 2 | |
| Profil: nama, avatar (file field + upload), kota | 2 | |
| Rate limit settings PB untuk endpoint auth + login (nilai dari keputusan PRD §6) | 1 | Pengganti middleware rate limit |
| Hook audit log: `onRecordAfter*` → koleksi `audit_logs` | 1 | |
| Admin: auth store PB (token + refresh otomatis) + role guard | 1 | |
| Swap lapisan API client admin & mobile ke SDK `pocketbase` (typed helper + `getFileUrl` untuk file) | 3 | Pekerjaan mekanis terbesar — semua layar |

**Demo:** Daftar→login→beranda (email & Google) di perangkat; avatar terupload & tampil.

### Sprint 11 — Scan AI via Custom Route (13 poin)

**Goal:** `POST /api/ekoteologi/scan` end-to-end di PocketBase: foto → LLM → JSON tervalidasi
→ tersimpan + poin.

| Story | Poin | Catatan |
|---|---|---|
| Custom route scan di `pb_hooks` (auth, multipart, validasi ukuran/tipe) | 2 | |
| Port LLM adapter ke JSVM: mock mode + openai_compat (`$http.send` → 9Router `127.0.0.1:20128/v1`), config via env, timeout/retry/fallback model | 3 | Live = 9Router di VPS (keputusan M5); biaya nol saat dev tetap (mock) |
| Validasi respons JSON + rekam `llm_raw`/`llm_meta` | 2 | PRD §5.3 |
| Cache `llm_cache` (koleksi + in-memory map) — target hit rate ≥70% | 1 | Pengganti Redis |
| Rate limit scan/user/hari (hook + koleksi counter) | 1 | |
| Ledger hook: append-only + sinkron `users.points` (transaksional) | 2 | PRD §5.10 #1 |
| Mobile: riwayat scan + filter kategori + integrasi sheet hasil ("+N Poin") | 2 | |

**Demo:** Scan di perangkat → hasil <2 detik dengan cache; mock mode & cache terbukti di log.

### Sprint 12 — Misi, Verifikasi & Gamifikasi (13 poin)

**Goal:** Loop misi tertutup di PocketBase: klaim → verifikasi → poin + notifikasi; level,
streak, badge hidup.

| Story | Poin | Catatan |
|---|---|---|
| CRUD misi admin (periode, poin, mode verifikasi) — lewat API koleksi + rules | 2 | |
| Klaim misi: photo (file field + consent), auto_scan (hook progres), manual (auto-approve) | 3 | |
| Anti dobel klaim: unique index `(user, mission, period_date)` + hook validasi periode | 1 | |
| Antrian verifikasi admin (approve/reject + catatan wajib) → ledger + notif in-app | 2 | `admin/verifikasi.html` |
| Level engine hook (recalc saat ledger bertambah) | 1 | |
| Streak harian hook (reset, bonus) + cron reminder | 2 | `cronAdd` |
| Badge engine hook (kriteria JSON → evaluasi event scan/klaim/streak) | 2 | |

**Demo:** Klaim bukti di perangkat → verifikasi admin → poin + level + badge + notif masuk.

### Sprint 13 — E-Learning, Notifikasi, QA & Rilis (12 poin)

**Goal:** MVP berjalan penuh di PocketBase dan rilis ulang ke internal testing.

| Story | Poin | Catatan |
|---|---|---|
| E-learning: koleksi modul/lesson (blok JSON)/bank soal/progress + hook penilaian kuis (anti dobel poin sekali per modul) | 3 | |
| Konten harian: publish terjadwal via cron hook + wisdom card/refleksi | 1 | `daily_contents` PRD §5.6 |
| Notifikasi event (streak reminder, misi approve, misi baru) → koleksi `notifications` + **realtime SSE** di mobile | 2 | Bonus PB: tanpa polling |
| FCM push via hook (`$http.send` → FCM HTTP v1, service account env) + composer push admin | 2 | Lihat risiko R4 |
| Hardening & ops: backup otomatis `pb_data` (cron), security header reverse proxy, error hook → Sentry/PB logs, metrik event, custom route agregasi dashboard admin (SQL via `$app.db`) | 2 | |
| QA cross-device + regresi alur kritis + rilis Play Store (internal testing) + release notes | 2 | |

**Demo:** Smoke E2E alur kritis hijau di staging PocketBase; notif push masuk di perangkat;
APK internal testing ter-update.

---

## 6. Strategi Teknis Pendukung

### 6.1 Arsitektur & kontrak

- **Satu binary PocketBase** (SQLite embedded, auth, file storage, realtime SSE, cron, admin
  dashboard bawaan) + ekstensi JS: `pb_migrations/` (skema) dan `pb_hooks/` (route & logika).
- **LLM tetap via backend** (PRD §4): hook scan memanggil **9Router** self-hosted di VPS
  (`127.0.0.1:20128/v1`, OpenAI-compatible; mock mode untuk dev); model/config via env;
  aplikasi klien tidak pernah memanggil LLM langsung.
- Kontrak API: skema koleksi + daftar custom route, didokumentasikan di `pocketbase/README.md`;
  klien memakai SDK `pocketbase` (auth, CRUD, file, realtime) + typed helper.
- Monorepo: `pocketbase/` + `admin/` + `mobile/`; share style tetap: `src/styles/tokens.css`
  disalin dari `docs/desain/tokens.css` (satu sumber di docs, dicatat di PR).

### 6.2 QA & lingkungan

| Lingkungan | Kegunaan |
|---|---|
| Local (binary PB atau compose) | Dev harian; LLM mock mode |
| Staging (VPS/Fly/Railway + volume) | Uji integrasi LLM asli + FCM + cut-over data; demo review |
| Prod | Setelah Sprint 13 (internal testing) |

Test plan: **uji integrasi HTTP terhadap instance PB uji** (skrip Node/Vitest — alur kritis:
auth, scan→poin, klaim→verifikasi→poin, kuis→lulus; disalin dari smoke FastAPI
`scripts/smoke`), component (Vitest) admin/mobile, manual device matrix (Android 10–14,
layar 360/390/430px, low-end RAM 2GB). Regresi: jalankan paralel staging PocketBase vs
FastAPI sebelum cut-over.

### 6.3 Metrik & instrumentasi (PRD §8)

Event tetap: `scan_pertama`, `misi_selesai`, `modul_selesai`, `streak_hari`. Dashboard admin
menampilkan penggunaan LLM (token & latency) & cache hit rate via custom route agregasi
(SQL `$app.db` di hook).

---

## 7. Risiko & Mitigasi (migrasi)

| Risiko | Mitigasi |
|---|---|
| PocketBase pre-1.0 — breaking change antar versi minor | Pin versi di CI & compose; upgrade terjadwal dengan baca changelog; smoke CI wajib hijau |
| Konkurensi tulis SQLite saat traffic puncak | Index tepat, batch API PB, satu instance (scale-up); monitor lock; opsi extension Go bila benar-benar perlu |
| Regresi logika bisnis saat porting (ledger, badge, streak, kuis) | Port per-domain di urutan sprint; uji integrasi alur kritis + bandingkan hasil staging PB vs FastAPI (paralel) sebelum cut-over |
| FCM HTTP v1 butuh OAuth RS256 — kemampuan signing di JSVM terbatas | Token service account via `$http`/`$security` dengan cache; fallback keputusan M2: extension Go kecil khusus push |
| Data historis dev/staging tidak otomatis pindah (Postgres → SQLite) | Keputusan M4: skrip ekspor→impor sekali pakai; MVP baru internal testing sehingga risiko data rendah |
| Plugin `camera-preview` tidak konsisten antar vendor | (Tetap) QA matrix; fallback `@capacitor/camera` |
| Latency/beban 9Router di VPS | (Tetap) cache `llm_cache`, mock mode default di dev, rate limit ketat, timeout + fallback model; 9Router hanya listen di `127.0.0.1` (tidak publik) |

---

## 8. Riwayat Eksekusi FastAPI (Sprint 0–8 — selesai)

MVP selesai dieksekusi dengan FastAPI + PostgreSQL + Redis (105 poin, 9 sprint, laporan
lengkap di `docs/sprint/`). Direktori `api/` diarsipkan saat cut-over (tag
`fastapi-archive`).

| Sprint | Isi | Poin |
|---|---|---|
| 0 | Fondasi teknis: monorepo, CI, FastAPI+Alembic+Postgres+Redis, scaffold admin/mobile | 12 |
| 1 | Auth & onboarding: JWT refresh, Google Sign-In, profil dasar, seed | 12 |
| 2 | Scan AI backend: endpoint LLM, prompt+validasi, mock mode, cache Redis, ledger | 12 |
| 3 | Scan AI mobile: UI scan signature, riwayat, consent, dashboard admin read-only | 12 |
| 4 | Misi: CRUD admin, klaim photo, daftar misi, anti dobel, dashboard chart | 12 |
| 5 | Misi: verifikasi, auto_scan/manual, level engine, streak | 12 |
| 6 | Gamifikasi: badge, leaderboard, profil statistik, home assembly, FCM, konten harian | 12 |
| 7 | E-learning: modul + kuis + poin, editor blok admin, progress, onboarding polish | 12 |
| 8 | Notifikasi event + composer push, QA cross-device, hardening, rilis Play Store | 15 |

---

## 9. Lampiran — Peta Mockup → Implementasi

Tidak berubah dari revisi 1 (semua view `mobile/src/views/*` dan `admin/src/views/*` sudah
ada dan tetap dipakai). Perubahan hanya pada **lapisan data**: setiap view/composable yang
memanggil fetch client custom kini memakai SDK `pocketbase` (Sprint 10), dan subscribe
realtime ditambahkan pada papan notifikasi mobile (Sprint 13). Rujukan silang mockup → view
tetap sesuai tabel di revisi 1 dan laporan `docs/sprint/sprint-0..8.md`.

---

*Rencana ini direviu tiap Sprint Review; pergeseran scope dicatat sebagai perubahan backlog,
bukan perubahan definisi MVP tanpa persetujuan PO. Sumber keputusan migrasi: diskusi
FastAPI → PocketBase (10 Sep 2026).*
