# Laporan Sprint 10 — Auth, Profil & Swap SDK Klien

> Periode: 10 September 2026 · Kapasitas: 12 poin · Status: **selesai — 7/7 story
> diterima (12/12 poin)** · Goal sprint: *Seluruh panggilan API admin & mobile
> sudah lewat SDK PocketBase; alur daftar → masuk → beranda jalan.*
> Catatan jujur: alur Google end-to-end menunggu kredensial OAuth asli (§5);
> perilaku bisnis yang butuh hook mengalir ke Sprint 11–13 sesuai rencana (§5).

---

## 1. Ringkasan

Sprint kedua migrasi (implementation-plan §4 Epic B2). Kedua aplikasi klien kini
**100% berbicara dengan PocketBase via SDK `pocketbase` 0.28.x** — klien HTTP
fetch custom (dan seluruh endpoint `/v1/*` FastAPI) pensiun dari master:

- **Backend (hook & settings)**: rate limit settings PB (migrasi settings
  bootstrap), hook audit log `audit_logs`, guard login per-identitas, dan
  provider OAuth2 Google (kondisional env) — semuanya terverifikasi otomatis.
- **Mobile**: auth store di atas `pb.authStore` (register/login/persist/
  refresh/logout), Google Sign-In native (system browser `@capacitor/browser`
  + deep link `@capacitor/app` + `authWithOAuth2Code` PKCE), profil (nama,
  kota, **upload avatar file + `getURL`**), dan swap seluruh layar (beranda,
  scan, riwayat, misi, e-learning, notif, streak, konten harian, push token).
- **Admin**: auth store PB + role guard (admin/verifier/editor) + refresh
  sesi otomatis, lalu swap 7 modul panel (dashboard, pengguna, verifikasi,
  misi, konten, e-learning, push).

Bukti cepat (kriteria demo):

| Kriteria demo | Hasil |
|---|---|
| Daftar → login → beranda (email) | ✅ E2E SDK 19 asersi: register → authWithPassword → authStore valid → authRefresh (sesi dipulihkan) → profil gabungan → misi/klaim → logout bersih (`pocketbase/scripts/e2e-sdk.mjs`) |
| Login via Google | ✅ kode alur lengkap (web popup + native Browser/deep link/PKCE) — **konsent Google asli belum teruji** karena kredensial OAuth belum tersedia di lingkungan dev; tanpa kredensial server, tombol memberi pesan ramah (graceful, teruji) |
| Avatar terupload & tampil | ✅ E2E: upload PNG via FormData ke field file `avatar` → `files.getURL` → HTTP 200 |
| Perangkat Android nyata | ⚠️ build web + `npx cap sync android` sukses (plugin `@capacitor/app`, `@capacitor/browser` terdeteksi) — uji sentuh di perangkat menunggu APK internal testing (Sprint 13 QA) |

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Mobile: auth email+password via PB SDK (register, login, token persist, logout) | 2 | ✅ | `mobile/src/stores/auth.ts` di atas `pb.authStore` (persist otomatis di localStorage WebView, kunci `pocketbase_auth`); `restoreSession()` menjalankan `authRefresh` (refresh otomatis saat app dibuka); register = `create` + `authWithPassword` (role dipaksa `user` oleh rule+hook server); logout = `authStore.clear()`. UI `AuthView` tidak berubah — kontrak store dipertahankan. |
| Google Sign-In native (Capacitor) → OAuth2 provider Google PB | 2 | ✅ | `services/googleAuth.ts`: **web** = popup SDK `authWithOAuth2`; **native** = `Browser.open` (system browser) → deep link custom scheme ditangkap `App.addListener('appUrlOpen')` → validasi `state` → `authWithOAuth2Code` (PKCE S256, `createData.role='user'`). Provider di server diaktifkan migrasi (env `GOOGLE_CLIENT_ID/SECRET`). Graceful: provider belum aktif → pesan ramah, alur email tetap jalan. Kredensial asli = prasyarat eksternal (§5). |
| Profil: nama, avatar (file + upload), kota | 2 | ✅ | `updateProfile` → PATCH koleksi `users` (guard anti-eskalasi field terjaga tetap aktif); `uploadAvatar` → FormData field file `avatar` (2 MB, mime divalidasi server); avatar URL via `pb.files.getURL`; profil gabungan (level dari koleksi `levels`, hitungan scan/misi/lencana dari koleksi milik user) mempertahankan bentuk `ProfileData` UI. |
| Rate limit settings PB utk auth + login | 1 | ✅ | Migrasi `1757500000_settings_bootstrap.js`: `users:authWithPassword` 30/15 menit/IP, `users:authRefresh` 60/menit/IP, `users:create` 20/jam/IP, pelindung `/api/` 300/10 dtk/IP (teruji 429 terjadi di percobaan ke-31). Rate limiter PB hanya per-IP → guard hook per-identitas 10 percobaan/15 menit/email (blokir 429 + audit `login_failed`), login sukses mereset — paritas middleware lama. |
| Hook audit log: `onRecordAfter*` → `audit_logs` | 1 | ✅ | Diimplementasikan sbg `onRecord{Create,Update,Delete}Request` + `onRecordAuthRequest` (lihat temuan §4 #1 — hook "after success" tidak punya konteks request). Aktor dari `e.auth` (user/superuser/anonim), diff old→new, field sensitif (`password`, `tokenKey`) disensor, tulisan gagal tidak menghasilkan audit palsu (`e.next()` melempar dulu). Create yang ditolak rule tidak ter-audit (teruji). |
| Admin: auth store PB + role guard | 1 | ✅ | `admin/src/stores/auth.ts` di atas authStore SDK + `PANEL_ROLES` (admin/verifier/editor) tetap di guard router; `fetchMe()` = `authRefresh`; refresh sesi otomatis tiap 30 menit saat navigasi. Login = `authWithPassword` koleksi `users` (bukan superuser). |
| Swap lapisan API client admin & mobile ke SDK (typed helper + `getFileUrl`) | 3 | ✅ | Mobile: `api/client.ts` = instance `pb` + `ApiError` (konversi `ClientResponseError`) + `fileUrl()`; 7 service + seluruh view/typing di-swap (id → string, `expand` untuk join, file via `getURL`). Admin: pola sama; 7 view memakai API koleksi + rules (verifikasi PATCH `user_missions`, CRUD misi/konten/modul/soal, dsb.). Daftar perilaku yang menunggu hook: §5. |

## 3. Yang Dibangun

### 3.1 `pocketbase/` (backend)

- **`pb_migrations/1757500000_settings_bootstrap.js`** — rate limits (di atas),
  meta aplikasi (nama/appURL/pengirim email), **autodate `created`/`updated`
  untuk seluruh koleksi non-sistem** (temuan v0.40 — §4 #3), dan **OAuth2
  Google kondisional env** (`mappedFields.name = "full_name"`; username &
  avatarURL dinonaktifkan — §4 #5). Down: matikan rate limit + hapus provider.
- **`pb_hooks/main.pb.js`** — tambahan sprint 10: 3 hook audit (create/update/
  delete, self-contained per batasan JSVM), `onRecordAuthRequest` (audit login
  + reset hitungan), `onRecordAuthWithPasswordRequest` (guard per-identitas,
  hitungan di `app_settings`, blokir 429 berbahasa Indonesia).
- **`scripts/e2e-sdk.mjs`** (baru) — 19 asersi E2E alur klien SDK; dibooting
  ke instance uji sekali pakai. Makefile target baru `pb-e2e`; CI job
  `backend` menjalankannya setelah `test.mjs`.
- **`scripts/test.mjs`** — diperluas 42 → **65 asersi** (§5 rate limit settings,
  §6 audit log, §7 guard login, §8 autodate + status OAuth2).
- **README + `.env.example`** — kontrak hook/settings baru + env
  `GOOGLE_CLIENT_ID/SECRET`, `EKO_APP_URL`, `EKO_SENDER_EMAIL`.

### 3.2 `mobile/`

- `api/client.ts` — instance SDK + `ApiError`/`toApiError` + `fileUrl()`.
- `stores/auth.ts` — login/register/restore(refresh)/profil/uploadAvatar/logout.
- `services/googleAuth.ts` — alur Google web + native (Browser + App + PKCE).
- 7 service di-swap: `scan` (create koleksi `scans` + kuota lokal 20/hari PRD
  §6), `missions` (join `missions`+`user_missions`, klaim photo/manual,
  lencana), `elearning` (modul/pelajaran/kuis + progres + percobaan kuis),
  `notifications` (milik+broadcast, tandai baca), `streak` (field users +
  kalender 7 hari dari scan), `dailyContent` (terjadwal + fallback bank),
  `push` (create `fcm_tokens`).
- View: `AuthView` (navigasi sukses Google), `ScanView` (sheet hasil `pending_ai`),
  riwayat/misi/e-learning (tipe id string), `MissionCard` (prop busyId string).
- Types disesuaikan (id string, `ScanResult.pending_ai`, kategori/quote null-
  able); `.env.example` + README (env `VITE_PB_URL`, `VITE_GOOGLE_CLIENT_ID`,
  `VITE_GOOGLE_OAUTH_REDIRECT`).

### 3.3 `admin/`

- `api/client.ts` (SDK), `stores/auth.ts`, `router/index.ts` (guard + refresh).
- 7 view: Dashboard (KPI pengguna/antrian dari koleksi; kartu scan/LLM jujur
  "menunggu route agregasi Sprint 13"), Users (filter/pencarian/pagination PB
  + tangga level), Verification (antrian `submitted` + expand + PATCH approve/
  reject dgn reviewed_by/at + catatan), Missions (CRUD + hitungan klaim),
  Modules (CRUD modul/pelajaran/soal + auto-buat kuis per modul), Contents
  (CRUD + unggah gambar file; status tayang dari `publish_date`), Push
  (pratinjau segmen dari koleksi users + riwayat broadcast; pengiriman aktif
  di Sprint 13 — ditampilkan jujur di UI).
- `.env.example`, README, `vite-env.d.ts` (`VITE_PB_URL`).

### 3.4 Infra

- `Makefile`: target `pb-e2e`. `.github/workflows/ci.yml`: job `backend`
  menambah step E2E SDK. Pin versi PB/SDK tidak berubah (v0.40.3 / 0.28.x).

## 4. Keputusan Teknis (dan temuan penting v0.40)

1. **`onRecordAfter*Success` tidak dipakai untuk audit** — event "after
   success" (RecordEvent) tidak membawa konteks request (`e.auth` selalu
   undefined), dan hook request yang keluar **tanpa `e.next()` mengaborsi
   rantai respons** (klien menerima 200 dengan body kosong — terbukti saat
   eksplorasi). Audit memakai `onRecord{Create,Update,Delete}Request`:
   `e.next()` dulu (melempar bila tulisan gagal → tidak ada audit palsu),
   lalu tulis baris audit dengan aktor `e.auth`.
2. **`get()` pada field json mengembalikan array bita JSON** (bukan objek/
   string) di JSVM — hitungan guard login wajib dinormalisasi defensif;
   tanpa itu hitungan selalu ter-reset ke 1 dan blokir tidak pernah terjadi.
3. **Autodate**: koleksi bawaan PB v0.40 tidak lagi menyertakan `created`/
   `updated`, dan deklarasi field eksplisit sprint 9 ikut tanpa keduanya.
   Menambahkannya wajib lewat `col.fields.add(new AutodateField(...))` —
   `fields.push(objek polos)` gagal konversi Go ("could not convert to
   core.Field").
4. **Rate limit settings**: label auth valid (`users:authWithPassword`,
   `users:authRefresh`, `users:create`, prefix `/api/`); `audience: ""`
   berarti semua (guest+auth) — nilai "all" justru ditolak validasi.
   Diverifikasi empiris: percobaan ke-31 dalam jendela → 429.
5. **OAuth2 mapped fields** memetakan ke field RECORD koleksi `users` kita:
   nama provider → `full_name` (field `name` tidak ada; `full_name` required),
   `username` dinonaktifkan, `avatarURL` dinonaktifkan (field `avatar`
   bertipe file — URL provider tak bisa disimpan; pengguna bisa unggah
   avatar sendiri di profil).
6. **`reviewed_by` tidak bisa diisi id superuser** (relasi ke koleksi
   `users`; superuser ada di `_superusers`) — panel admin justru login
   sebagai user staff sehingga alur nyata aman; E2E mengikuti pola itu
   (user dipromosikan superuser → login → approve).
7. **Adapter menjaga kontrak UI**: bentuk `ProfileData`, `MissionsPage`,
   `QuizResult`, dsb. dipertahankan; service menjadi lapisan adaptasi
   PB → kontrak (termasuk pemetaan status `submitted` → `pending` kontrak
   UI, dan 400 unique-index klaim → 409 "Sudah Diklaim"). Konsekuensi:
   sebagian agregasi berjalan di klien sementara (daftar §5).

## 5. Penyimpangan & catatan jujur — "menunggu Sprint 11/12/13"

Sesuai instruksi sprint, endpoint yang koleksinya belum punya perilaku khusus
diarahkan ke API koleksi bawaan; perilaku bisnisnya menyusul:

**Menunggu Sprint 11 (Scan AI):**
- `submitScan` sementara menyimpan foto ke koleksi `scans` tanpa analisis —
  hasil bertanda `pending_ai` (nama objek/kategori/saran/quote/poin kosong),
  sheet hasil menampilkan status itu secara jujur.
- Kuota harian dihitung klien (jumlah scan hari ini vs 20/hari PRD §6); pemakaian
  `Retry-After` server + cache `llm_cache` hidup bersama hook scan.

**Menunggu Sprint 12 (Misi, Verifikasi & Gamifikasi):**
- Poin klaim/approve belum mengalir: verifier menetapkan `points_awarded` di
  klaim, tetapi **ledger append-only + cache `users.points` + notifikasi user**
  baru jalan lewat hook (microcopy toast/klaim sudah jujur soal ini; klaim
  manual sementara berstatus `submitted`, bukan auto-approve).
- Ringkasan mingguan misi, kalender streak, dan badge "earned" dihitung klien
  dari data yang sudah ada (engine streak/badge di hook menyusul).

**Menunggu Sprint 13 (E-learning, notif, rilis):**
- Penilaian kuis dihitung klien (soal terbit publik) + dicatat append-only di
  `user_quiz_attempts`; poin lulus & anti-dobel server-side via hook kuis.
- Realtime SSE, FCM push, dan pengiriman broadcast composer (koleksi
  `notifications` terkunci create via rule — hook notifikasi menyusul);
  PushView menampilkan pratinjau segmen + status "aktif di Sprint 13".
- Route agregasi dashboard admin (SQL `$app.db`) untuk KPI scan/LLM/cache —
  kartu & chart terkait tampil "menunggu route agregasi".
- Notifikasi "hasil verifikasi" belum dibuat oleh hook mana pun (event verifikasi
  = Sprint 12) sehingga badge notif misi belum hidup.

**Prasyarat eksternal yang belum tersedia di lingkungan dev** (juga dicatat di
laporan Sprint 9): kredensial Google OAuth asli — alur Google diimplementasi
penuh + graceful error, dan diuji sampai batas yang mungkin (provider tidak
aktif → pesan ramah; konfigurasi provider via env terverifikasi by migration +
assert `oauth2.enabled === false` tanpa env). Uji sentuh perangkat Android
nyata menunggu kredensial & APK internal testing (Sprint 13).

## 6. Verifikasi (bukti lokal, semua lulus)

| Perintah | Hasil |
|---|---|
| `make pb-test` | **65 PASS / 0 FAIL** — termasuk §5 rate limit settings, §6 audit log (aktor, diff, sensor password, create ditolak tak ter-audit), §7 guard login (5 gagal → 400; sukses mereset; ke-11 → 429 + audit `login_failed`; identitas lain tidak ikut terkunci), §8 autodate + OAuth2 nonaktif tanpa env |
| `make pb-e2e` | **19 PASS / 0 FAIL** — register → login → authRefresh → PATCH profil → upload avatar (getURL 200) → profil gabungan (levels + hitungan) → misi publik + klaim + anti dobel → antrian verifier + approve → audit login → broadcast → logout |
| `make pb-smoke` | PASS `/api/health`, PASS `/api/ekoteologi/ping` |
| Rate limit empiris | 30 login/15 menit/IP → 429 tepat di percobaan ke-31 |
| Admin | `npm run lint` ✅ · `npm run test` 29/29 ✅ · `npm run build` (vue-tsc + vite) ✅ |
| Mobile | `npm run lint` ✅ · `npm run test` 81/81 ✅ · `npm run build` ✅ · `npx cap sync android` ✅ (3 plugin Capacitor terdeteksi) |
| Lint JS backend | `node --check` semua `pb_hooks/*.pb.js`, `pb_migrations/*.js`, `scripts/*.mjs` (termasuk e2e-sdk) |
| Pin versi | PocketBase v0.40.3 (Makefile/Dockerfile/ci.yml) & SDK `pocketbase` 0.28.1 (admin/mobile) tidak berubah |

## 7. Blocker

Tidak ada blocker yang menghentikan sprint. Prasyarat eksternal yang masih
terbuka (tidak baru): kredensial Google OAuth (butuh OAuth Client di Google
Cloud Console + redirect URI terdaftar — panduan di `pocketbase/.env.example`)
dan akses 9Router di staging untuk Sprint 11.

## 8. Ke Sprint 11

Klien sudah penuh di atas SDK; backend tinggal menambah **route kustom scan**
(`pb_hooks` + 9Router mock/live) — klien mobile hanya perlu mengganti satu
fungsi `submitScan` ke route baru saat itu. Koleksi `llm_cache`, `scans`
(`llm_raw`/`llm_meta`), dan ledger sudah menunggu terpakai.
