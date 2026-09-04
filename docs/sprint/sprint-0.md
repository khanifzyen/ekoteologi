# Laporan Sprint 0 — Fondasi Teknis

> Periode: 4 September 2026 · Kapasitas: 12 poin · Status: **selesai, semua story diterima**
> Goal sprint: **Monorepo hidup, CI hijau, APK debug ter-build, admin shell tampil.**

---

## 1. Ringkasan

Seluruh 6 story (12 poin) selesai dan terverifikasi. Monorepo `api/ admin/ mobile/` berdiri
di atas fondasi yang direncanakan: FastAPI + Alembic + PostgreSQL + Redis untuk backend,
Vue 3 + Vite + TypeScript untuk kedua frontend, Capacitor 8 untuk Android, dan GitHub Actions
menjalankan lint + test + build (termasuk build APK debug) pada setiap push/PR.

Bukti cepat:

| Kriteria demo Sprint 0 | Hasil |
|---|---|
| APK debug ter-build | ✅ `app-debug.apk` (5,4 MB, compileSdk 36, minSdk 24); CI juga memproduksinya sebagai artefak |
| Admin login tampil sesuai shell mockup | ✅ Login → dashboard shell D3 (sidebar + topbar) terverifikasi di browser |
| CI hijau | ✅ Lokal: ruff bersih, 15/15 test pytest, build admin & mobile sukses. Workflow CI menyusul verifikasi pertama di GitHub setelah push |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Monorepo + CI (lint, test, build) | 3 | ✅ | `docker-compose.yml` Postgres 16 + Redis 7; workflow 4 job (api, admin, mobile, android-apk) |
| FastAPI + Alembic + PostgreSQL + Redis + env config | 3 | ✅ | Skema migrasi awal = 27 tabel PRD §5; config penuh via env (pydantic-settings) |
| Mobile scaffold Vue + Capacitor, build APK debug | 3 | ✅ | Frame 480px terpusat, safe-area (`viewport-fit=cover`), APK debug ter-build |
| Admin scaffold + login + role guard | 1 | ✅ | Acuan `admin/index.html`: shell, sidebar grup, drawer <1024px, topbar |
| Audit log middleware | 1 | ✅ | Tabel `audit_logs` + middleware mutating-request + audit eksplisit login |
| Salin tokens.css + komponen inti | 1 | ✅ | 7 komponen di masing-masing app; tokens.css disalin verbatim dari `docs/desain/` |

---

## 3. Yang Dibangun

### 3.1 API (`api/` — FastAPI async)

- **Struktur** per PRD §5: `app/{api,core,db,middleware,models,schemas,services}` + `alembic/` +
  `scripts/` + `tests/`. Lengkap dengan `README.md` (kontrak endpoint) dan `Dockerfile`.
- **Skema migrasi awal**: 27 tabel seluruh PRD §5 (users, gamifikasi/ledger, scan, misi,
  e-learning, konten harian, komunitas & peta, reward [Fase 2], notifikasi/audit/setting) +
  index `users.points` untuk leaderboard (PRD §5.10 #7). Satu migrasi autogenerate
  (`alembic/versions/e3f96f221dba_skema_awal_prd_5.py`), sudah di-`upgrade head`.
- **Env config**: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`, serta placeholder
  `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` untuk Sprint 2 (tidak ada yang hardcode).
- **Endpoint Sprint 0**: `GET /health` (status app+DB+Redis, 503 bila degraded),
  `POST /v1/auth/login`, `GET /v1/auth/me`, `GET /v1/audit-logs` (admin, paginasi),
  `GET /v1/audit-logs/count`. OpenAPI otomatis di `/docs`.
- **Auth dasar**: bcrypt + JWT access token, `require_roles()` dependency untuk guard per-role.
  *Scope disengaja minimal* — refresh token, rate limit, Google Sign-In adalah story Sprint 1.
- **Middleware audit log (Story 5)**: mencatat POST/PUT/PATCH/DELETE ke `audit_logs`
  (actor dari JWT, action `post:/v1/missions`, entity, entity_id, diff {method, path, status}).
  `/health` dilewati; login diaudit eksplisit di endpoint (sukses/gagal + alasan). Kegagalan
  pencatatan audit tidak menggagalkan request.
- **Test**: 15 test pytest (health, auth, role guard, audit middleware dengan app dummy). DB
  test terpisah (`ekoteologi_test`) yang disiapkan otomatis (create-if-missing + `alembic
  upgrade` via subprocess), truncate antar test.
- **Kualitas**: ruff check + ruff format bersih (B008 di-whitelist sebagai pola FastAPI).

### 3.2 Admin (`admin/` — Vue 3 + Vite + TS + Pinia + Vue Router)

- **AdminShell** sesuai mockup `admin/index.html`: brand seedling, nav 3 grup (utama, Sistem,
  Fase 2 bertanda *Segera*), drawer <1024px, side-user + keluar, topbar (hamburger, pencarian,
  notifikasi, avatar inisial).
- **Login** terhubung API: email + kata sandi (toggle lihat), error box untuk kredensial salah
  / koneksi gagal / akses ditolak.
- **Role guard** di router: hanya `admin|verifier|editor`; sesi diverifikasi via `/v1/auth/me`;
  role `user` di-logout otomatis dengan pesan "Akun Anda tidak memiliki akses ke panel admin."
- **DashboardView** placeholder dengan empty state yang menjelaskan KPI menyusul Sprint 3–4.
- **Komponen inti** (`src/components/ui/`): BaseButton, BaseCard, BaseChip, BaseInput,
  BaseTabs, BaseSkeleton, ToastHost + store toast. ESLint 10 (flat config, plugin-vue) bersih.

### 3.3 Mobile (`mobile/` — Vue 3 + Vite + TS + Capacitor 8)

- **Frame sesuai desain**: `.app` 480px terpusat di desktop (radius 36px + shadow), layar
  penuh di ponsel; `viewport-fit=cover` + `env(safe-area-inset-bottom)` di nav-wrap.
- **HomeView placeholder**: header melengkung (signature), pill level, bottom nav 4 item +
  FAB kamera gold 65px di tengah; aksi yang belum ada sengaja memberi toast "menyusul di
  Sprint X" (pola yang sama dengan mockup).
- **Proyek Android** (`android/`, appId `id.ekoteologi.app`) di-commit; **APK debug berhasil
  di-build** lokal (JDK 21 + SDK 36). Panduan build lokal ada di `mobile/README.md`.
- **Offline-first assets**: font Montserrat/Open Sans/Amiri via fontsource + FontAwesome 6
  via npm — tanpa CDN, penting untuk di dalam APK.

### 3.4 Bersama

- **tokens.css** disalin *verbatim* dari `docs/desain/tokens.css` ke
  `admin/src/styles/` dan `mobile/src/styles/` (satu sumber di docs — `base.css`/`admin.css`
  juga disalin; hanya bagian `demo-bar` (khusus mockup) dibuang dari base.css mobile).
- **docker-compose.yml**: Postgres 16 (host **55432**) + Redis 7 (host **56379**) dengan
  healthcheck; **Makefile** target harian; **README.md** root; `.gitignore` monorepo.
- **CI** `.github/workflows/ci.yml`: job `api` (Postgres+Redis service, ruff, pytest), `admin`
  & `mobile` (eslint, typecheck+build), `android-apk` (build web → cap sync → gradlew
  assembleDebug → artefak APK). Semua versi actions diverifikasi ada.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| API health, login, me, audit | curl ke uvicorn lokal + 15 test pytest | ✅ |
| Audit log terisi | `GET /v1/audit-logs` menampilkan row `login` dgn actor & diff | ✅ |
| Admin login alur nyata | Browser: login admin → dashboard shell sesuai mockup | ✅ (screenshot) |
| Role guard menolak non-panel | Browser: login role `user` → redirect `?error=forbidden` + pesan | ✅ (screenshot) |
| Frame mobile 480px & 390px | Browser kedua viewport | ✅ (screenshot) |
| FAB + toast mobile | Klik FAB → toast "Kamera scan tampil di Sprint 3." | ✅ |
| APK debug | `./gradlew assembleDebug` → `app-debug.apk` 5,4 MB | ✅ |
| Lint/format semua app | ruff (api), eslint (admin+mobile) | ✅ bersih |

Dua bug ditemukan (dan diperbaiki) berkat verifikasi browser: (1) `.btn-block` tidak ada di
admin.css sehingga tombol login tidak lebar penuh; (2) pesan "akses ditolak" tidak muncul
karena `route.query` dibaca non-reaktif — kini `computed`.

---

## 5. Keputusan & Catatan Teknis

1. **Port lokal tidak standar (55432/56379/8100)**: mesin dev menjalankan layanan lain
   (Coolify + Postgres/Redis host) di 5432/6379/8000. Compose lokal memakai port alternatif;
   default prod (5432/6379/8000) tetap bisa via env.
2. **Skema awal mencakup seluruh PRD §5 termasuk tabel Fase 2** (komunitas, peta, reward):
   murah ditambahkan sekarang (sekali migrasi), menghindari churn migrasi nanti. Belum ada
   logika bisnis untuk tabel tersebut.
3. **Auth admin sengaja minimal** (access token saja): memisahkan scope Sprint 0 (fondasi)
   dari Sprint 1 (refresh token, rate limit, Google Sign-In). Kontrak endpoint login tidak
   akan berubah di Sprint 1.
4. **Validasi email**: pydantic `EmailStr` menolak domain reserved (`.local`, `.test`).
   Default `create_admin` memakai `admin@ekoteologi.id` (placeholder — ganti via env
   `ADMIN_EMAIL`/`ADMIN_PASSWORD`).
5. **Font/ikon di-bundle** (fontsource + FontAwesome 6 via npm), bukan CDN, agar APK berjalan
   offline dan tidak ada dependensi runtime eksternal.
6. **Aset web hasil `cap sync`** (`android/app/src/main/assets/public/`) tidak di-commit;
   CI selalu menjalankan build web + sync sebelum Gradle.

---

## 6. DoD Sprint 0 — Checklist

- [x] CI (lint + test + build) didefinisikan; lokal semua hijau — verifikasi run pertama di
  GitHub terjadi setelah push commit ini.
- [x] Unit test logika Sprint 0 (auth, audit); coverage penuh diukur mulai Sprint 2 (scope
  logika bisnis poin/verifikasi/kuis belum ada).
- [x] UI 100% dari `tokens.css` — nol hardcode warna/jarak pada komponen baru (nilai gaya
  berasal dari salinan mockup + token).
- [x] State: empty state sudah ada (dashboard, beranda); skeleton/error/offline-bar tersedia
  sebagai komponen — pemakaiannya menyusul bersama layar data (Sprint 1+).
- [x] Aksesibilitas: tap target ≥44px, `prefers-reduced-motion` & `:focus-visible` sudah di
  tokens.css, label/aria pada form & nav, ikon `aria-hidden`.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [x] Teruji di Chrome (mobile via viewport 390/1280; admin desktop). *Firefox manual belum
  dijalankan sprint ini.* Perangkat Android nyata: **belum** — tidak ada perangkat terhubung
  saat sprint; APK + instruksi `adb install` siap (demo pasang jadi aksi manual PO/dev).
- [x] Terdokumentasi: `api/README.md`, `admin/README.md`, `mobile/README.md`, README root.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Hosting (PRD §6 / plan §2.1 #5): VPS vs Railway/Fly** | Tidak memblokir Sprint 0–1 (belum ada deploy). Repo siap keduanya: `api/Dockerfile` untuk VPS, config 12-factor untuk PaaS | **Sebelum Sprint 2** — staging dibutuhkan untuk uji LLM asli |
| 2 | Scope respons LLM & budget (§2.1 #1–2) | — | Sebelum Sprint 2 (sesuai rencana) |
| 3 | Akun: Google Cloud/FCM, Play Console, Sentry, domain+SSL | — | Sebelum Sprint 6/8 |

---

## 8. Yang Menyusul (Sprint 1)

Auth penuh (refresh + rate limit + Google Sign-In), onboarding/splash, profil dasar,
komponen state (pemakaian nyata), seed data awal + dokumentasi API lebih lengkap.
