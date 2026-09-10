# Laporan Sprint 13 — E-Learning, Notifikasi, QA & Rilis

> Periode: 10 September 2026 · Kapasitas: 12 poin · Status: **selesai — 6/6
> story diterima (12/12 poin)** · Goal sprint: *MVP berjalan penuh di
> PocketBase dan rilis ulang ke internal testing.*
> Catatan jujur: uji sentuh perangkat Android nyata & unggah Play Console
> tetap manual (butuh akun/perangkat — item terbuka sejak Sprint 0/8);
> semuanya sudah disiapkan di repo (APK debug sukses, checklist + release
> notes v1.1.0). Kredensial FCM asli belum tersedia — mode `fcm` diuji penuh
> terhadap endpoint mock (JWT RS256 diverifikasi crypto Node) dan **fallback
> log wajib-teruji** lewat instance terpisah.

---

## 1. Ringkasan

Sprint kelima & penutup migrasi (implementation-plan §4 Epic B5). Seluruh
sisa "menunggu Sprint 13" dari laporan Sprint 10–12 tuntas:

- **E-learning dinilai server** — 6 route hook (`pb_hooks/elearning.pb.js`):
  modul/pelajaran/kuis. Kunci jawaban TIDAK pernah ke klien (koleksi
  `quiz_questions`/`quizzes` dikunci dari baca publik — menggantikan
  client-grading yang membocorkan `answer`); lulus → poin **sekali per modul**
  via ledger append-only (anti dobel — lulus ulang = `already_passed_before`,
  0 poin); progres pelajaran berurutan dihitung server; pelajaran terakhir
  yang menuntaskan modul memicu event `modul_selesai` + streak + badge
  (transisi sekali) — semua mengalir lewat engine ledger/level/streak/badge
  sprint 11–12 tanpa menyentuh engine.
- **Konten harian** — route `GET /api/ekoteologi/daily-content` (paritas
  `content.py` + bank quote `quotes.py` FastAPI: selalu 200, flag `fallback`)
  + cron auto-publish (`cronAdd`): bila admin belum menjadwalkan hari ini,
  satu konten dari bank terbit otomatis (idempoten via unique index;
  `DAILY_CONTENT_AUTOPUBLISH=0` mematikan; trigger manual route admin).
- **Notifikasi event → realtime + push** — pipeline di hook
  `onRecordAfterCreateSuccess` (`pb_hooks/push.pb.js`): SETIAP baris
  `notifications` yang lahir (verifikasi misi, bonus streak, reminder cron,
  lencana, poin kuis, **misi baru**, broadcast) otomatis di-push — user
  terisi → token miliknya; user kosong → token per segmen. Realtime in-app
  = SSE bawaan PB (`/api/realtime`) — mobile subscribe via SDK (E2E: notif
  diterima TANPA polling). Push FCM HTTP v1 di JSVM: **JWT RS256 murni JS**
  (SHA-256 + RSA PKCS#1 v1.5 via BigInt goja — `$security` hanya HS256/HS512)
  → access token (cache L1 store + L2 `app_settings`) → `messages:send`;
  token 404/410 dihapus. Tanpa kredensial → fallback log (fail-safe).
- **Composer push admin** — `GET /admin/push/segments` (preview penerima/
  token) + `POST /admin/push/broadcast` (semua/segmen; validasi 4–64 & 8–300;
  SATU baris broadcast `user=""` + rekap `{recipients,tokens,sent}` di
  `payload.push` + audit `push.broadcast`).
- **Hardening & ops** (`pb_hooks/ops.pb.js`) — dashboard agregasi admin
  (`/api/ekoteologi/admin/dashboard`: KPI pengguna/scan/verifikasi, cache hit
  rate, token & biaya LLM, chart 14 hari + kategori 7 hari), backup otomatis
  `pb_data` (fitur bawaan PB dari env `BACKUP_*` + route manual admin),
  cleanup cron kunci `app_settings` kedaluwarsa + `llm_cache` kadaluarsa
  (catatan sprint 11–12 tuntas), error hook → Sentry/PB logs (middleware
  `routerUse`; error bisnis 4xx tidak dilaporkan), guard `notifications`
  (pemilik hanya boleh `read_at`), dan **review klaim full-atomik**.

Bukti cepat (kriteria demo goal — "smoke E2E alur kritis hijau; notif push
masuk di perangkat; APK internal testing ter-update"):

| Kriteria demo | Hasil |
|---|---|
| E2E alur kritis hijau | ✅ pb-test **254 asersi** + E2E SDK **51 asersi** + smoke, semua PASS lokal (CI menyusul di commit). Kuis→poin, klaim→verifikasi→poin, scan→poin, broadcast→penerima, realtime→penerima |
| Notif push masuk | ✅ Alur server teruji penuh dgn endpoint mock: OAuth JWT diverifikasi crypto Node, `messages:send` menerima pesan `Bearer` + token, token DEAD → 410 → baris token terhapus, rekap `payload.push.sent` benar. **Perangkat asli menunggu kredensial FCM + APK terpasang (manual — checklist §13.4)** |
| APK ter-update | ✅ `make apk`/gradle `assembleDebug` BUILD SUCCESSFUL (app-debug.apk); unggah AAB = langkah manual Play Console (checklist diperbarui) |

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| E-learning: koleksi modul/lesson (blok JSON)/bank soal/progress + hook penilaian kuis (anti dobel poin sekali per modul) | 3 | ✅ | Koleksi sudah ada sejak Sprint 9; sprint 13 menghidupkannya via 6 route hook + kunci rules (migrasi): `quizzes`/`quiz_questions` baca = staff saja (kunci jawaban aman), `user_quiz_attempts` & `user_module_progress` tulis terkunci (attempt `passed=true` palsu tidak bisa memanen lencana `quiz_passed` — teruji). Penilaian murni server: skor/percent/passed/review (kunci+penjelasan sesudah submit). Poin sekali per modul: cek attempt `passed` sebelum menilai → 0 poin + flag `already_passed_before` (teruji: gagal 50% → 0 poin → lulus 100% → +20 → lulus ulang → 0). Semua efek (ledger source=quiz, notif, event, streak, badge) dalam satu transaksi; `users.points`/level tersinkron hook ledger. |
| Konten harian: publish terjadwal via cron hook + wisdom card/refleksi | 1 | ✅ | Route `GET /daily-content` (auth): konten `publish_date` hari ini, else fallback rotasi deterministik bank 8 quote (hari sama = kutipan sama — paritas `daily_fallback_quote`). Cron `ekoteologi_daily_publish` (env `DAILY_CONTENT_CRON` default "5 0 * * *") auto-publish dari bank + `eco_action` rotasi bila admin belum buat (idempoten — teruji: created 1 → 0; jadwal admin tidak pernah ditimpa). Trigger manual route admin. |
| Notifikasi event → koleksi `notifications` + realtime SSE di mobile | 2 | ✅ | Notif in-app sudah diproduksi hook sprint 12; sprint 13 menambah event "misi baru" (broadcast saat misi aktif diterbitkan — paritas `announce_new_mission`) dan **realtime SSE**: mobile `subscribeNotifications()` (SDK `pb.collection('notifications').subscribe('*')`) di Beranda → badge misi & toast seketika (E2E SDK: broadcast admin diterima subscriber TANPA polling). Push perangkat = pipeline FCM di story berikutnya (sumber sama: baris notifikasi). |
| FCM push via hook (`$http.send` → FCM HTTP v1) + composer push admin | 2 | ✅ | Pipeline hook `onRecordAfterCreateSuccess` (teruji ikut terpanggil utk tulisan internal dalam transaksi): resolusi penerima (user / segmen all, aktif_7hari, pasif_7hari, bertoken — paritas `broadcast.py`), pengirim `PUSH_MODE=log\|fcm`; **fcm** = service account (file/env) → JWT RS256 (RSA via BigInt) → token OAuth (cache, sekali tukar — teruji 35 notif 1 tukar) → `messages:send`; token 410/404 dihapus; rekap `payload.push` di-set hook (broadcast route cukup membaca balik). Tanpa kredensial/project → fallback log (teruji instance terpisah). Composer admin: preview segmen + kirim + validasi + audit (teruji). |
| Hardening & ops: backup otomatis, security header proxy, error hook → Sentry/PB logs, route agregasi dashboard (`$app.db`), pembersihan `app_settings` kedaluwarsa, atomisasi review PATCH | 2 | ✅ | **Backup**: fitur bawaan PB dari migrasi (env `BACKUP_ENABLED/BACKUP_CRON/BACKUP_KEEP`) + route manual admin (`$app.createBackup(new Context(), …)`) — arsip terbaca `/api/backups` (teruji). **Security header**: dokumentasi Caddy/Nginx di `pocketbase/README.md` (HSTS, nosniff, frame-deny, referrer, CSP, permissions-policy). **Error hook**: middleware `routerUse` menangkap error tak terduga (tanpa status / ≥500) → Sentry (`SENTRY_DSN`) + PB logs — teruji dgn route fault di instance terpisah. **Dashboard**: `GET /admin/dashboard` (staff) — SQL `$app.db().newQuery().all()` terbukti gagal di JSVM (diverifikasi ulang: "Invalid variable type: must be a pointer") → agregasi `findRecordsByFilter` + JS; admin Vue tersambung (KPI + ChartLine + ChartBar). **Cleanup**: cron `ekoteologi_cleanup` + route admin — `sr:/scan_quota:/sd:` bertanggal lewat, guard login lewat jendela, cache token FCM kadaluarsa, `llm_cache` expires lewat (teruji; kunci segar selamat). **Review atomik**: PATCH staff = satu `runInTransaction` (save + ledger + notif + event + streak + badge + audit) — rollback teruji end-to-end dgn instance fault-injection (ledger dimatikan → approve 500, klaim TETAP submitted, 0 poin, tanpa notif hantu, tanpa ledger hantu). Bonus hardening: kepemilikan klaim dipaksa server (anti pembajakan `user`/`mission` via PATCH). |
| QA cross-device + regresi alur kritis + rilis Play Store (internal testing) + release notes | 2 | ✅ (sepanjang lingkungan memungkinkan) | Regresi otomatis diperluas: pb-test 171→**254 asersi** (§11 e-learning, §12 konten harian+cron, §13 broadcast+FCM mock, §14 ops, §15 fault-injection), E2E SDK 35→**51 asersi** (§9 e-learning via `pb.send`, §10 realtime SSE + broadcast + daily-content + dashboard), smoke hijau. Admin & mobile lint/test/build hijau; **APK debug sukses**. Uji sentuh perangkat + unggah AAB = manual (checklist `docs/release/PLAY-STORE-CHECKLIST.md` §13 + release notes `RELEASE-NOTES-v1.1.0.md` siap; versionCode 2). |

## 3. Yang Dibangun

### 3.1 `pocketbase/` (backend)

- **`pb_hooks/elearning.pb.js`** (baru) — 6 route e-learning + route/cron
  konten harian; helper penilaian murni (port `services/elearning.py`);
  bank quote (port `services/quotes.py`).
- **`pb_hooks/push.pb.js`** (baru) — pipeline notifikasi→push (hook model),
  FCM HTTP v1 (RS256 JSVM + OAuth cache), broadcast + segments (admin),
  guard `read_at`.
- **`pb_hooks/ops.pb.js`** (baru) — dashboard agregasi, cleanup cron + route,
  backup manual route, error middleware Sentry.
- **`pb_hooks/gamification.pb.js`** — engine review ditulis ulang full-atomik
  di hook request (efek hook model lama dihapus → tidak ada dobel); event
  "misi baru" broadcast.
- **`pb_migrations/1757700000_sprint13_bootstrap.js`** — kunci
  `user_quiz_attempts`/`user_module_progress`, `quizzes`/`quiz_questions`
  baca staff; backup bawaan PB dari env.
- **`pb_hooks/main.pb.js`** — versi ping `0.1.0-sprint13`.
- **`scripts/test.mjs`** — 171 → **254 asersi** (5 bagian baru; +mock server
  OAuth/FCM/Sentry dgn RSA keypair uji; +instance fault-injection).
- **`scripts/e2e-sdk.mjs`** — 35 → **51 asersi** (§9–§10 baru; +polyfill
  EventSource utk Node — browser/mobile tidak perlu).
- **README + .env.example** — kontrak 13 route baru + hook sprint 13 + env
  (`PUSH_MODE`, `FCM_*`, `QUIZ_*`, `DAILY_CONTENT_*`, `BACKUP_*`,
  `CLEANUP_CRON`, `SENTRY_DSN`, `LLM_COST_PER_1K_TOKENS`) + contoh security
  header reverse proxy.

### 3.2 `admin/`

- `views/DashboardView.vue` — sumber utama route agregasi (`pb.send`): KPI
  pengguna/scan/verifikasi/LLM+cache, chart garis scan harian & batang
  kategori (ChartBar dipakai lagi); state error/loading tetap.
- `views/PushView.vue` — composer hidup: preview segmen dari route
  (penerima+token), kirim via route broadcast, hasil rekap
  (`broadcastSummary`), riwayat dari payload rekap.

### 3.3 `mobile/`

- `services/elearning.ts` — seluruh kontrak pindah ke route hook (klien tidak
  lagi membaca `quiz_questions`/menulis progres); pill poin diperbarui dari
  `points_total` server saat poin kuis masuk.
- `services/notifications.ts` — `subscribeNotifications()` (SDK realtime
  subscribe, kontrak `RealtimeNotification`) + dok realtime.
- `views/HomeView.vue` — subscribe/unsubscribe realtime di siklus hidup;
  badge misi & toast notifikasi baru tanpa polling.
- `services/dailyContent.ts` — route `daily-content`; bank lokal hanya utk
  luring (status 0).

### 3.4 Infra & docs

- Tidak ada perubahan compose/Dockerfile/Makefile/CI — job `backend`
  otomatis menjalankan lint + test 254 asersi + E2E 51 asersi + smoke
  (lint glob mencakup file hook baru).
- `docs/release/RELEASE-NOTES-v1.1.0.md` (baru) +
  `docs/release/PLAY-STORE-CHECKLIST.md` (bagian §13 — rilis ulang v1.1.0,
  versionCode 2, prasyarat server FCM/backup/proxy, QA manual).

## 4. Keputusan Teknis (dan temuan penting v0.40/JSVM)

1. **`delete` sebagai key properti object-literal MEMATAHKAN parser goja**
   (`SyntaxError: Unexpected identifier` saat boot — ditemukan saat menulis
   migrasi; `node --check` lolos karena JS sah, goja gagal). Solusi: kunci
   dikutip `rules["delete"]`. Dicatat agar tidak menempel di sprint berikutnya.
2. **`$os.readFile` mengembalikan ARRAY BITA**, bukan string
   (`String(buf)` → "104,101,…" — panjang karakter koma, bukan isi file).
   Normalisasi `String.fromCharCode` per-chunk. Sama untuk `res.body` hasil
   `$http.send` — helper `jsonBody()` di push.pb.js (pola `bodyToJson` scan).
3. **RS256 bisa murni di JSVM**: `$security` hanya punya HS256/HS512, tetapi
   goja punya BigInt → SHA-256 murni JS + RSA PKCS#1 v1.5 (CRT) untuk JWT
   service account FCM: sign ~5 ms, **diverifikasi crypto Node** di test
   (bukan sekadar "sekadar terkirim"). Kunci privat PKCS#8 diparse DER manual
   (rekursi juga masuk OCTET STRING 0x04). Ini menghindarkan extension Go
   khusus push (mitigasi R4 rencana) — extension Go tidak dibutuhkan.
4. **Short-circuit hook request TERNYATA persisten** (temuan baru, melengkapi
   sprint 10): hook `onRecordUpdateRequest` boleh TIDAK memanggil `e.next()`,
   menyimpan record sendiri di `runInTransaction`, lalu menutup respons dgn
   `e.json(200, …)` — hasil tersimpan (diverifikasi empiris; catatan: query
   `findRecordsByFilter` DI DALAM tx tetap tak melihat baris baru — delta).
   Dipakai untuk review klaim full-atomik; hook audit umum tidak berjalan utk
   PATCH tsb → baris audit ditulis manual dalam transaksi yang sama.
5. **`onRecordAfterCreateSuccess` ikut terpanggil utk tulisan internal di
   dalam transaksi** (teruji) → satu pipeline push utk semua notifikasi
   (event & broadcast); rekap ditulis hook ke `payload.push`, route broadcast
   cukup membaca balik. Re-save rekap = update, tidak memicu rekursi create.
6. **SQL `$app.db().newQuery().bind().all()` tetap gagal** di JSVM v0.40.3
   ("Invalid variable type: must be a pointer" — diverifikasi ulang). Agregasi
   dashboard memakai `findRecordsByFilter` (binding params teruji) + hitung di
   JS; satu query bulan berjalan mencakup jendela hari ini/7/14 hari.
7. **FCM tanpa kredensial = fallback log fail-closed-per-mode**: mode `fcm`
   yang kredensialnya tidak layak turun ke log dgn peringatan (teruji), bukan
   error ke user — paritas `get_push_sender()` FastAPI.
8. **Kunci koleksi mengikuti alur data baru** (paritas sprint 11–12): soal
   kuis (baca staff), attempt & progres (tulis via route) — menutup celah
   "manen lencana `quiz_passed`" via create API.
9. **Node E2E butuh polyfill EventSource**: SDK `pocketbase` memakai
   `EventSource` global + event bernama `PB_CONNECT` (`lastEventId`) —
   polyfill fetch-SSE kecil di `e2e-sdk.mjs` (browser/mobile tidak terdampak).
10. **`$app.createBackup` butuh context Go**: `new Context()` (binding JSVM)
    sebagai argumen pertama — bukan versi satu-argumen.

## 5. Penyimpangan & catatan jujur

- **Uji sentuh perangkat & unggah Play Store tetap manual** (akun Google
  Play Console, perangkat fisik — item terbuka sejak Sprint 0). Yang bisa
  diverifikasi tanpa akun sudah diverifikasi: APK debug BUILD SUCCESSFUL,
  seluruh regresi otomatis hijau, checklist & release notes siap.
- **Kredensial FCM asli belum tersedia** (item terbuka sejak Sprint 6). Mode
  `fcm` diuji end-to-end terhadap mock Google (OAuth + messages:send) dgn
  verifikasi kriptografis; yang belum teruji: jaringan FCM asli + notif masuk
  di perangkat. Fallback log teruji eksplisit (instance `PUSH_MODE=fcm` tanpa
  `FCM_PROJECT_ID`).
- **Agregasi dashboard memuat baris per-jendela-waktu ke memori JS** (SQL
  tidak tersedia di JSVM — temuan §4 #6). Untuk skala MVP aman; kalau volume
  scan tumbuh besar, pertimbangkan pra-agregasi ke koleksi ringkasan via cron.
- **Push berjalan di dalam transaksi pembuat notifikasi** (hook model). Mode
  log instan; mode fcm menambah latensi jaringan ke tx (MVP: jumlah token
  kecil; dicatat utk pemantauan).
- **Leaderboard/`GET /v1/leaderboard` tidak di-port** — Fase 2 sesuai rencana
  (index `users.points` + field level sudah siap sejak Sprint 12).
- **Analisis 9Router live tidak diulang sprint ini** — sudah teruji penuh di
  Sprint 11 (§6 laporan); tidak ada perubahan jalur scan di sprint 13.
- Uji sentuh lintas perangkat (matriks `docs/qa/DEVICE-MATRIX.md`) menunggu
  perangkat — checklist §13.4 memuat skenario sprint 13 (kuis, realtime,
  broadcast, push, offline).

## 6. Verifikasi (bukti lokal, semua lulus)

| Perintah | Hasil |
|---|---|
| `make pb-test` | **254 PASS / 0 FAIL** — termasuk §11: kunci soal/attempt/progres, daftar+detail modul (CTA/ringkasan), kuis gagal→lulus→lulus ulang (anti dobel poin 20), ledger source=quiz, notif/event/streak/badge kuis, pelajaran berurutan + modul selesai sekali (event persis 2), 404 ramah; §12: fallback bank → jadwal admin → cron auto-publish (created 1→0, tidak menimpa jadwal); §13: segmen 4 item, broadcast rekap sent/dead/mode=fcm, **JWT RS256 diverifikasi crypto Node** (iss/scope/aud), token DEAD 410 terhapus, OAuth cache 1 tukar utk 35+ notif, event "misi baru", validasi composer + non-admin; §14: dashboard KPI/chart (hit rate 75%), cleanup (4 kunci + 1 cache buang, segar selamat), backup (settings.backups.cron default + route manual + arsip terlihat), guard read_at; §15: instance fault-injection — approve dgn ledger mati → 500, **klaim tetap submitted, 0 poin, tanpa notif/ledger hantu (rollback atomik)**, Sentry mock menerima event, reject → push fallback mode=log |
| `make pb-e2e` | **51 PASS / 0 FAIL** — §9: e-learning via `pb.send` (kartu modul, soal tanpa kunci, koleksi soal terkunci, pelajaran berurutan, kuis lulus +20 tersinkron authRefresh, lulus ulang 0 poin); §10: **realtime SSE** (broadcast admin diterima subscriber tanpa polling), preview segmen + broadcast route + rekap, daily-content, dashboard staff; §1–8 (regresi) tetap hijau |
| `make pb-smoke` | PASS `/api/health`, PASS `/api/ekoteologi/ping` (versi `0.1.0-sprint13`) |
| Lint JS backend | `node --check` semua `pb_hooks/*.pb.js`, `pb_migrations/*.js`, `scripts/*.mjs` |
| Admin | `npm run lint` ✅ · `npm run test` 29/29 ✅ · `npm run build` (vue-tsc + vite) ✅ |
| Mobile | `npm run lint` ✅ · `npm run test` 81/81 ✅ · `npm run build` ✅ · `npx cap sync android` ✅ · `./gradlew assembleDebug` **BUILD SUCCESSFUL** (app-debug.apk) |
| Pin versi | PocketBase v0.40.3 & SDK `pocketbase` 0.28.1 tidak berubah |

## 7. Blocker

Tidak ada blocker teknis. Prasyarat eksternal yang tetap terbuka (lama, bukan
baru) dan kini menjadi syarat aktivasinya:

- **Kredensial FCM/Google asli** (service account + `FCM_PROJECT_ID`) — untuk
  push nyata; tanpa itu sistem aman di mode log (teruji).
- **Akun Google Play Console + perangkat Android fisik** — unggah AAB v1.1.0
  (versionCode 2) + QA sentuh matriks perangkat.
- **OAuth Client ID Google** (sejak Sprint 1) — Google Sign-In.
- **Domain/SSL produksi + DSN Sentry** — ops (pola header tersedia di README).

## 8. Status Akhir Migrasi PocketBase (penutup Sprint 9–13)

Migrasi backend FastAPI → PocketBase **selesai**: seluruh 63 poin Epic B1–B5
tereksekusi (13+12+13+13+12), MVP berjalan penuh di satu binary PocketBase
v0.40.3 (pin). Ringkasan perubahan vs era FastAPI:

| Aspek | Era FastAPI | Kini (PocketBase) |
|---|---|---|
| Runtime | FastAPI + Postgres + Redis + worker scheduler | **Satu binary PB** (SQLite, auth, file, realtime SSE, cron, backup) + `pb_hooks` JSVM |
| Logika bisnis | 22 router + services Python | Route hook: scan AI, klaim/verifikasi, level/streak/badge, **kuis**, konten harian, push/broadcast, dashboard — koleksi sensitif terkunci (scan, ledger, badge, attempt, progres, notif) |
| Auth | JWT manual + refresh + OAuth glue | Auth collection bawaan + OAuth2 Google kondisional env; guard login per-identitas + rate limit settings |
| Realtime & push | Polling klien + FCM (sender log saja) | **SSE bawaan PB** (subscribe SDK) + pipeline FCM HTTP v1 dari baris notifikasi (RS256 murni JSVM; fallback log) |
| Jadwal | Scheduler in-process asyncio | `cronAdd`: streak reminder, auto-publish konten, cleanup, backup bawaan PB |
| Observabilitas | middleware audit + sentry-sdk | hook audit → `audit_logs`, error middleware → Sentry/PB logs, metrik `analytics_events`, dashboard agregasi |
| API kontrak | OpenAPI otomatis | Dokumentasi manual `pocketbase/README.md` (13+ route hook + rules 29 koleksi); SDK `pocketbase` 0.28.x di admin & mobile |
| Pengujian | pytest + coverage | pb-test **254** + E2E SDK **51** asersi (integrasi HTTP/SDK dgn mock LLM/FCM/OAuth/Sentry + instance fault-injection) + vitest admin 29 & mobile 81 |

Sisa tugas di luar kode (menunggu pihak eksternal — semuanya terdokumentasi
di `docs/release/PLAY-STORE-CHECKLIST.md` §13 dan `.env.example`):

1. Kredensial Google asli: OAuth Client ID (Sign-In) + service account FCM
   (`FCM_CREDENTIALS_FILE`, `FCM_PROJECT_ID`, `PUSH_MODE=fcm`).
2. Hosting produksi: VPS/domain/SSL + reverse proxy dgn security header
   (pola siap di README) + volume `pb_data`.
3. Play Console: unggah AAB v1.1.0 (versionCode 2) ke internal testing +
   isi Data safety/privacy (checklist §3).
4. QA sentuh perangkat (matriks `docs/qa/DEVICE-MATRIX.md` + skenario §13.4).
5. Fase 2 (di luar MVP): leaderboard, komunitas, peta, reward, PWA penuh.

## 9. Hasil Run CI

| Run | Commit | Hasil |
|---|---|---|
| #33 | `7f3dad3` | **Hijau 4/4 job** — Backend PocketBase (lint, 254 asersi pb-test, 51 asersi E2E SDK, smoke), Admin (lint/test/build), Mobile web (lint/test/build), Mobile APK debug (gradlew assembleDebug) |

## 10. Ke Sprint 14 (Fase 2 — di luar rencana migrasi)

MVP tuntas di PocketBase. Backlog Fase 2 (leaderboard agregat, komunitas,
peta, reward, PWA offline penuh — PRD §6/§7) menunggu refinement PO; fondasi
yang sudah siap: index `users.points`, koleksi fase-2 (posts/rewards/
map_locations/redemptions) ter-port sejak Sprint 9, engine poin/level/streak/
badge yang dapat dipakai ulang, dan pipeline realtime/push yang sama untuk
notifikasi komunitas.
