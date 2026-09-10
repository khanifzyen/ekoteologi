# Laporan Sprint 9 — Fondasi PocketBase

> Periode: 10 September 2026 · Kapasitas: 13 poin · Status: **selesai — 6/6 story
> diterima (13/13 poin)** · Goal sprint: *PocketBase jalan lokal + staging, seluruh
> skema ter-port jadi koleksi.* Satu kriteria demo goal ("login admin Vue via
> PocketBase") digeser ke Sprint 10 dgn alasan terdokumentasi (§5) — sprint ini
> berada di tengah migrasi, dan koordinator memutuskan koneksi admin/mobile belum
> boleh diubah di sprint ini (swap SDK memang story Sprint 10).

---

## 1. Ringkasan

Sprint pertama migrasi backend FastAPI → PocketBase (implementation-plan revisi 2,
§4 Epic B1). Dalam satu sprint backend berpindah totalitas: direktori `api/`
(22 router, SQLAlchemy, Alembic, Redis) dipensiunkan — diarsipkan ke tag git
`fastapi-archive` (ter-push sebelum penghapusan, riwayat tetap utuh di git) — dan
digantikan direktori `pocketbase/`: **satu binary PocketBase v0.40.3 (pin)** +
ekstensi JS (`pb_migrations` skema+seed, `pb_hooks` route & guard).

**Seluruh skema lama kini hidup sebagai koleksi PocketBase**: 28 koleksi hasil port
1:1 dari 25 modul model SQLAlchemy (`app/models/*` — termasuk tabel fase-2 posts/
rewards/peta agar skema lengkap) + 1 koleksi baru `llm_cache` (persiapan sprint 11,
pengganti Redis) = **29 koleksi**, dengan relasi, unique/partial index (anti dobel
klaim `(user, mission, period_date)`!), field file pengganti kolom URL gambar, dan
`users` sebagai auth collection. API rules memindahkan otorisasi dari
`core/deps.require_roles` ke rule per koleksi: default deny, ownership
`@request.auth.id`, role `user|verifier|editor|admin` — plus guard hook anti
eskalasi role/poin yang tidak mungkin diekspresikan rule saja.

Semua terverifikasi **`pocketbase/scripts/test.mjs` — 42 asersi HTTP otomatis**
(health, ping, kelengkapan koleksi, seed 7+10+10, registrasi publik terjaga role,
ownership scans, antrian verifier, ledger append-only, broadcast notifikasi, modul
draf tersembunyi, dll.) — 42/42 PASS, plus smoke, plus build & boot via Docker
Compose, plus lint/test/build admin (29 vitest) & mobile (81 vitest) tetap hijau.

Bukti cepat (kriteria demo Sprint 9):

| Kriteria demo | Hasil |
|---|---|
| Daftar koleksi sesuai skema lama di Dashboard PB | ✅ 29/29 koleksi terverifikasi via `GET /api/collections` (asersi otomatis test.mjs §2): users (auth), fcm_tokens, levels, point_transactions, badges, user_badges, waste_categories, scans, missions, user_missions (+consent_at), modules, lessons, quizzes, quiz_questions, user_module_progress, user_quiz_attempts, daily_contents, posts, post_likes, post_comments, reports, map_locations, rewards, redemptions, notifications, audit_logs, analytics_events, app_settings, llm_cache |
| PocketBase jalan lokal | ✅ `make pb-serve` (binary) dan `docker compose up -d` (service `pocketbase` v0.40.3, volume `pb_data`, healthcheck) — keduanya teruji: `/api/health` 200, seed terbaca via API publik |
| CI hijau job `backend` | ✅ Ekuivalen lokal lulus penuh (lint JS, sinkronisasi pin, unduh binary pin, 42 asersi, smoke) — job `backend` baru berjalan di GitHub Actions setelah push laporan ini; hasil run dicatat commit terpisah sesuai konvensi repo |
| ~~Login admin Vue via PocketBase~~ | ➡️ Digeser ke Sprint 10 — swap koneksi klien dilarang di sprint ini (instruksi koordinator; di rencana, "auth store PB" & "swap SDK" memang story Sprint 10). Pengganti terukur sprint ini: alur auth `users` diuji langsung via HTTP (registrasi publik terjaga role, auth-with-password, guard anti-eskalasi) — test.mjs §4 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Scaffold `pocketbase/` (binary pin v0.40.x, `pb_hooks/`, `pb_migrations/`, `pb_data` gitignore, superuser init via env, `.env.example`) | 2 | ✅ | Pin **v0.40.3** (patch terbaru seri v0.40.x — keputusan M1); satu sumber versi di `Makefile` + `Dockerfile` + CI dgn asersi sinkronisasi di CI. Binary di-gitignore, diunduh via `make pb-install`. Superuser via env `PB_SUPERUSER_EMAIL/PASSWORD` — catatan: PB v0.40 tidak lagi membuat superuser otomatis dari env saat serve, maka inisialisasi dieksekusi `pocketbase superuser upsert` dari env (Makefile `pb-superuser` + entrypoint Docker). `pb_hooks/main.pb.js`: route kustom pertama `GET /api/ekoteologi/ping` + guard hook. `.env.example` lengkap (PB_*, EKO_*, LLM_* persiapan M5, FCM_* persiapan sprint 13). README modul = kontrak API. |
| Port skema: semua model SQLAlchemy → koleksi + relasi + index via `pb_migrations` | 5 | ✅ | `pb_migrations/1757400000_init_schema.js` — 29 koleksi (28 port `app/models/*` termasuk fase-2 + `llm_cache` baru). `users` = auth collection (menghapus koleksi bawaan PB dulu, lalu deklarasi penuh: full_name/phone/avatar/role/points/city/streak/is_active/last_active_date). Relasi `collectionId` diselesaikan runtime; unique/partial index: `ux_users_phone (WHERE != '')`, `ix_users_points` (leaderboard), `ux_levels_level`, `ux_badges_code`, `ux_user_missions_claim (user,mission,period_date) WHERE != ''` (PRD §5.10 #3), `ux_user_module_progress`, `ux_user_badges`, `ux_post_likes`, `ux_modules_slug`, `ux_daily_contents_publish_date`, `ux_app_settings_key`, `ux_llm_cache_key`, dll. Down migration menghapus terbalik. |
| API rules: role user/admin, ownership, default deny | 2 | ✅ | Default deny (rule kosong = superuser saja); publik baca: kategori/level/badge/misi aktif/modul terbit (turun ke lessons/quizzes/soal via traversal relasi)/konten harian (publish_date ≤ sekarang)/peta; ownership `user = @request.auth.id` utk scans/progress/fcm/profil; role: admin penuh, editor konten (pengganti `require_roles("admin","editor")`), verifier antrian verifikasi (+admin). Koleksi tulis-hook dikunci total: point_transactions (append-only), user_badges, notifications (create), audit_logs (tulis), analytics_events, app_settings, llm_cache. Registrasi publik dipaksa role `user` (create rule menerima kosong → hook normalisasi; role=admin → ditolak, teruji). Guard hook menolak PATCH `role/points/is_active/current_streak/longest_streak/last_active_date` oleh non-admin (updateRule tidak bisa membandingkan nilai lama–baru). |
| Seed data awal (kategori sampah, levels, badges) sebagai migration — idempoten | 1 | ✅ | `pb_migrations/1757400100_seed_initial_data.js` — port data `scripts/seed.py`: 7 kategori, 10 level (ladder 1→10), 10 badge (kriteria JSON). Idempoten: lookup kunci natural (name/level/code) sebelum insert. **Terbukti**: uji deterministik — baris "Organik" pra-eksisting (icon `fa-custom`) → seed membuat hanya 26, Organik lama utuh tak tersentuh. Misi contoh & modul e-learning sengaja tidak di-seed (scope story; CRUD-nya sprint 12–13). |
| Infra: docker-compose (hapus Postgres+Redis → service `pocketbase`), Makefile `pb-*`, README | 2 | ✅ | Compose: service `pocketbase` (build `pocketbase/Dockerfile` ARG pin 0.40.3 + `docker-entrypoint.sh` superuser-env, volume `pb_data`, healthcheck `/api/health`, host port 56180) — db/redis dihapus. Makefile: `api-*` → `pb-install`, `pb-serve`, `pb-superuser`, `pb-test`, `pb-smoke` (tanpa migrate/seed — migration jalan otomatis saat serve, terbukti di compose). README root + `pocketbase/README.md` (kontrak: koleksi+rules, route kustom, konvensi env, catatan upgrade pre-1.0) + catatan env klien di admin/mobile README. `.gitignore`: `pocketbase/pocketbase`, `pb_data/`, `*.zip`; entri `api/var/` dihapus. |
| CI: job `api` → `backend` (unduh PB pin, instance uji, smoke `/api/health`, lint JS) | 1 | ✅ | Job `backend`: asersi sinkron pin (Makefile vs Dockerfile), `node --check` seluruh `.pb.js`/`*.js`/`*.mjs`, unduh binary pin, `test.mjs` (42 asersi), `smoke.mjs`. Job `admin`, `mobile`, `android-apk` **tidak berubah**. |

---

## 3. Yang Dibangun

### 3.1 `pocketbase/` (baru)

- **`pb_migrations/1757400000_init_schema.js`** — deklarasi 29 koleksi (up) + penghapusan
  terbalik (down). Helper `save()`/`rel()`; konstanta rule ADMIN/ADMIN_EDITOR/STAFF/AUTHED/OWN.
- **`pb_migrations/1757400100_seed_initial_data.js`** — seed idempoten (7+10+10) dengan
  guard kunci natural; down menghapus per kunci.
- **`pb_hooks/main.pb.js`** — `GET /api/ekoteologi/ping` (dipakai smoke CI) + normalisasi
  create `users` (role kosong→`user`, `is_active`→true) + guard update field terjaga.
- **`scripts/test.mjs`** — 42 asersi (boot instance sekali pakai: `superuser upsert` →
  `serve` → HTTP; port bebas otomatis; bersih-bersih dir).
- **`scripts/smoke.mjs`** — health + ping.
- **`Dockerfile` + `docker-entrypoint.sh`** — image pin 0.40.3, superuser dari env, healthcheck.
- **`.env.example`, `README.md`** — konvensi env & kontrak API lengkap.

### 3.2 Infra & root

- `docker-compose.yml` — hanya service `pocketbase` (db/redis hapus).
- `Makefile` — `PB_VERSION`/`PB_ARCH`, target `pb-install|pb-serve|pb-superuser|pb-test|pb-smoke`;
  seluruh target `api-*` dihapus.
- `.github/workflows/ci.yml` — job `api` → `backend`; `admin`/`mobile`/`android-apk` utuh.
- `README.md`, `.gitignore`, catatan env di `admin/README.md` & `mobile/README.md`.
- `api/` dihapus dari master setelah tag `fastapi-archive` dibuat & di-push
  (`8883097`/`4f32e3f` — commit docs revisi rencana + manual book, terlebih dulu).

---

## 4. Keputusan Teknis (dan temuan penting v0.40)

1. **Koleksi bawaan `users`**: PB v0.40 membuat koleksi `users` default saat init —
   migrasi menghapusnya lalu mendeklarasikan ulang secara penuh (fresh instance, sebelum
   data; solusi paling deklaratif dan tervalidasi migrasi).
2. **`PB_SUPERUSER_*` tidak lagi auto-create saat serve** di v0.40 → inisialisasi
   tetap env-driven via `pocketbase superuser upsert` (Makefile & entrypoint Docker).
3. **Urutan evaluasi rule vs hook (penting utk sprint berikutnya)**: create rule
   dievaluasi **sebelum** `onRecordCreateRequest` — rule registrasi harus menerima
   `role` kosong dan dinormalisasi hook sesudahnya; update rule dievaluasi saat fetch
   record, guard hook berjalan setelah `form.Load` → cek berbasis **kunci body**
   (perbandingan nilai lama–baru tidak bisa dilakukan rule dan tidak reliable utk
   field tak tersentuh).
4. **Validasi `required` pada number menolak 0** (min_points level 1 = 0) → field
   `min_points` tanpa `required` (tetap `min: 0`); tanpa default field di PB,
   `role` diisi via hook create.
5. **Pemetaan field**: `created_at` → sistem `created` (autodate); `avatar_url`/
   `image_url`/`proof_image_url` → field **file** (avatar 2MB, image/proof 5MB,
   jpeg/png/webp) sesuai arah sprint 10–12; `cover` modul tetap teks (berisi nama ikon
   FontAwesome atau URL — kontrak klien lama); `ref_id`/`target_id` BIGINT → teks
   (id PB string); `google_sub` tidak di-port — OAuth Google bawaan menyimpan via
   koleksi sistem `_authOrigins` (sprint 10); `lat/lng` → number; `period_date` →
   date (partial index `!= ''` meniru semantik NULL DISTINCT Postgres).
6. **`llm_cache` dibuat sejak sekarang** (kunci unique + index expires, default deny) —
   fondasi pengganti Redis sprint 11; tidak ada perubahan migrasi besar nanti.
7. **Koleksi fase-2 tetap dibuat** (posts, post_likes/comments, reports, map_locations,
   rewards, redemptions) — skema lengkap sesuai arahan; rules-nya sudah mengikuti
   kebijakan (soft delete, like unik, report admin-only).

## 5. Penyimpangan & catatan jujur

- **"Login admin Vue via PocketBase"** (kriteria demo goal sprint 9 di rencana)
  **tidak dikerjakan di sprint ini**: swap koneksi admin dilarang instruksi sprint
  ("admin & mobile belum boleh diubah koneksinya") dan story "auth store PB +
  swap SDK admin" memang milik Sprint 10 (1p + 3p). Tidak ada pekerjaan Sprint 10
  yang dikerjakan duluan. Pengganti terukur: alur auth & rules `users` terverifikasi
  via HTTP otomatis (registrasi terjaga role, login, guard eskalasi).
- **CI GitHub Actions** untuk commit sprint ini berjalan setelah push; seluruh
  perintah yang dijalankan job `backend` sudah lulus identik di lokal (§6). Hasil
  run dicatat sebagai commit `docs(sprint)` terpisah sesuai konvensi repo.
- Sebelum sprint ini, ada perubahan docs yang belum ter-commit (revisi rencana +
  PRD migrasi, manual book sprint 8) — di-commit terpisah di awal sprint (`8883097`,
  `4f32e3f`) agar basis tag `fastapi-archive` bersih.

## 6. Verifikasi (bukti lokal, semua lulus)

| Perintah | Hasil |
|---|---|
| `make pb-test` (3×) | 42 PASS / 0 FAIL — smoke endpoint, 29 koleksi, field users, unique index anti dobel, consent_at, seed 7/10/10, default deny, registrasi (role=user wajib; tanpa role → default), ownership scans (create/list/view), guard eskalasi, PATCH profil sendiri, misi publik, klaim + anti dobel, verifier list + approve, ledger sistem-only + baca pemilik, broadcast + notif create terkunci, modul draf tersembunyi, role admin baca audit |
| `make pb-smoke` | PASS `/api/health`, PASS `/api/ekoteologi/ping` |
| Idempotensi seed | migrasi pra-seed menyisip "Organik" custom → seed lulus dgn "baru dibuat: 26", baris lama (fa-custom, 9 poin) utuh |
| `docker compose build && up` | image 0.40.3 ter-build; container sehat; `/api/health` 200; seed terbaca via API publik tanpa langkah manual (migration otomatis) |
| Lint JS backend | `node --check` semua `pb_hooks/*.pb.js`, `pb_migrations/*.js`, `scripts/*.mjs` |
| Admin | `npm run lint` ✅ · `npm run test` 29/29 ✅ · `npm run build` ✅ |
| Mobile | `npm run lint` ✅ · `npm run test` 81/81 ✅ · `npm run build` ✅ |
| Sinkron pin | `PB_VERSION := 0.40.3` konsisten di Makefile, Dockerfile, ci.yml (diasersi di CI) |

## 7. Blocker

Tidak ada blocker. Lingkungan menyediakan jaringan (binary v0.40.3 diunduh langsung
dari rilis GitHub). Untuk sprint berikutnya yang perlu diperhatikan: kredensial
Google OAuth (Sprint 10) dan akses 9Router di staging (Sprint 11) masih berupa
prasyarat eksternal yang belum tersedia di lingkungan dev ini.

## 8. Ke Sprint 10

Koleksi & rules sudah siap dikonsumsi SDK: auth email+password (`users`),
profil (avatar file), rate limit settings PB, hook audit log (`audit_logs` sudah
terkunci dengan rule baca-admin), lalu swap lapisan API admin & mobile.
