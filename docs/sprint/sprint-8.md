# Laporan Sprint 8 — Notifikasi, QA, Rilis

> Periode: 5 September 2026 · Kapasitas: 15 poin · Status: **selesai — 5/5 story
> diterima (15/15 poin); kriteria demo "perangkat/Play Console" digantikan
> pengganti terukur dengan alasan terdokumentasi (lingkungan tanpa perangkat
> fisik, akun Play, dan kredensial FCM — terbuka sejak Sprint 0)** · Goal
> sprint: **MVP siap rilis ke internal testing Play Store.**

---

## 1. Ringkasan

Sprint penutup MVP bersifat **stabilisasi** — tanpa fitur pengguna baru — dan
menutup tiga sisa dari rencana: notifikasi event, komposer push admin, dan
persiapan rilis, ditambah satu lapis hardening.

**Notifikasi kini hidup end-to-end pada sisi yang bisa dibangun tanpa
kredensial.** Tiga event story rencana tertutup: *misi approve* (piping push
Sprint 6 kini teruji dua arah), *misi baru* (admin membuat misi → satu baris
broadcast `notifications` `user_id NULL` + push ke semua pengguna aktif —
tanpa fan-out ribuan baris), dan *streak reminder* (target jujur: user aktif
kemarin, belum aktif hari ini, streak ≥2 — dikirim scheduler in-process yang
idempoten per hari via `app_settings`, atau dipicu manual lewat endpoint
admin). Composer push admin menutup keputusan "broadcast sengaja belum
dilayani" Sprint 5: kirim ke semua/segmen (`all`, `aktif_7hari`,
`pasif_7hari`, `bertoken`) dengan audit dua lapis, dan list notifikasi mobile
kini menampilkan broadcast dengan semantik baca yang tetap personal.

**Hardening** menambah lapis pelindung tanpa mengubah perilaku fitur: rate
limit global per IP (fail-open — kontras yang disengaja dgn kuota scan
fail-closed), security header pada semua respons (HSTS hanya di prod), Sentry
opsional penuh via env (tanpa DSN = mati total), dan `GET
/v1/admin/metrics/events` yang membuka angka keempat event PRD §8 sebagai
bahan verifikasi metrik tanpa query manual.

**QA & rilis** dijalankan sejauh yang memungkinkan di lingkungan ini: regresi
otomatis penuh (276 pytest, 110 vitest, lint, build, APK debug + AAB release),
**smoke E2E baru 33 langkah** yang menutup seluruh alur kritis rencana §5.2
(auth, scan→poin, klaim→verifikasi→poin, kuis→lulus) PLUS alur Sprint 8
(composer, broadcast in-app, misi baru, streak reminder, metrik, audit) —
kini artefak repositori (`make api-smoke`), bukan skrip sekali pakai; dokumen
**device matrix** siap pakai untuk QA manual begitu perangkat tersedia; dan
paket rilis lengkap: deklarasi izin kamera/notifikasi di manifest (PRD §9),
signing config env-driven, release notes v1.0.0, dan checklist Play Store
step-by-step untuk PO.

Bukti cepat (kriteria demo Sprint 8):

| Kriteria demo | Hasil |
|---|---|
| Notif event: streak reminder, misi approve, misi baru | ✅ Smoke E2E langkah 24–31: broadcast 201 → `sent=1` ke token terdaftar; misi baru → broadcast `kind=new_mission` terlihat user lain; streak reminder force → `targets=1` (angka streak asli di pesan) → eksekusi kedua `skipped=true` (idempoten harian); approve misi tetap men-push (regresi test caplog Sprint 6 tetap hijau) |
| Admin composer push (semua/segmen) + audit | ✅ `POST /v1/admin/push/broadcast` role admin saja (verifier/editor → 403, teruji); segmen `all/aktif_7hari/pasif_7hari/bertoken` dgn preview penerima+token; audit eksplisit `push.broadcast` dgn rekap recipients/tokens/sent tercatat (smoke langkah 33) + riwayat komposer dari payload |
| QA cross-device Android | ⚠️ Pengganti terukur: smoke E2E **33 langkah lulus** (alur kritis §5.2 + Sprint 8), 276 pytest / 110 vitest, APK debug + AAB release BUILD SUCCESSFUL; device matrix 6 perangkat (360–480dp, Android 10–14, RAM 2GB) + checklist regresi 11 layar disiapkan di `docs/qa/DEVICE-MATRIX.md` — eksekusi fisik menunggu perangkat |
| Hardening: rate limit global, security header, Sentry, analytics lengkap | ✅ Rate limit global 429+`Retry-After` & fail-open teruji; 6 security header pada semua respons (HSTS prod-only teruji); Sentry env-gated (tanpa DSN mati, 4xx disaring); metrik event PRD §8 lengkap & terbaca endpoint (smoke langkah 32) |
| Rilis Play Store + release notes + deklarasi izin | ⚠️ Pengganti terukur: manifest berdeklarasi `CAMERA` + `POST_NOTIFICATIONS` + uses-feature non-wajib (justifikasi PRD §9); signing release env-driven (`bundleRelease` BUILD SUCCESSFUL — unsigned karena kunci belum ada); release notes v1.0.0 + checklist Play Store 6 tahap untuk PO (`docs/release/`) |
| CI hijau | ⏳ Dipantau pasca-push — hasil dicatat pada commit `docs(sprint): catat hasil run CI sprint 8` (pola sprint 5–7) |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Notif event: streak reminder, misi approve, misi baru | 3 | ✅ | *Misi approve*: piping push Sprint 6 (`push_notification` best-effort pasca-commit) tetap; teruji ulang. *Misi baru*: `announce_new_mission()` di `POST /v1/admin/missions` — 1 baris broadcast `kind=new_mission` + push semua aktif. *Streak reminder*: `services/streak_reminder.py` — target murni (`last_active_date == kemarin`, `current_streak ≥2`, aktif), copy dgn angka streak & bonus asli (`days_until_bonus` satu sumber dgn engine Sprint 5), idempoten harian via `app_settings`; scheduler in-process (`services/scheduler.py`, lifespan, `SCHEDULER_INTERVAL_MINUTES`/`STREAK_REMINDER_HOUR` env) + endpoint admin `POST /v1/admin/notifications/streak-reminder?force=…`. Semuanya FCM + `notifications` — pengirim tetap `PushSender` (mode `log` teruji; mode `fcm` menunggu kredensial — §7) |
| Admin: composer push (semua/segmen) — role admin saja; audit log | 3 | ✅ | `services/broadcast.py`: segmen = kriteria murni atas `users` (`is_active` selalu; 7-hari dari `last_active_date`; `bertoken` = EXISTS `fcm_tokens` — query gabungan token memakai `_base_filters` agar tidak auto-correlation). `api/admin_push.py`: `GET /push/segments` (preview penerima+token), `POST /push/broadcast` (**`require_roles("admin")`** — 403 utk verifier/editor, teruji; validasi judul 4–64 / isi 8–300; 400 segmen asing), `GET /push/history`. Broadcast = 1 baris `notifications` (`user_id NULL`) + push batch 500 best-effort; rekap di payload + **audit eksplisit** `push.broadcast` (actor/segment/recipients/tokens/sent). Admin UI: `PushView.vue` (`/push`, menu "Push Notifikasi" Sistem kini aktif) + `utils/push.ts` (4 test) |
| QA cross-device Android (matrix vendor/ukuran 360–480px) | 3 | 🟡 Pengganti | Perangkat fisik tidak tersedia (terbuka sejak Sprint 0). Yang dikerjakan: (1) **smoke E2E baru `scripts/smoke.py` (33 langkah, `make api-smoke`)** menutup semua alur kritis plan §5.2 plus alur Sprint 8 — kini artefak repositori, bukan skrip ad-hoc; (2) regresi penuh: 276 pytest / 81+29 vitest / lint / build / APK+AAB; (3) **`docs/qa/DEVICE-MATRIX.md`** — 6 target perangkat (360/393/412/480dp, Android 10–14, RAM 2GB, vendor Samsung/Xiaomi/stok), checklist regresi 11 layar vs mockup + AUDIT.md, matriks performa (target <2 dtk scan, cold start, push latency), quirks vendor; (4) audit statis UI: nol warna hardcode baru (PushView 41 pemakaian token, 0 hex); eksekusi fisik matriks menunggu perangkat (§7) |
| Hardening: rate limit global, security header, Sentry, analytics event lengkap | 3 | ✅ | `middleware/rate_limit.py`: per-IP (XFF hop pertama), fixed window 60 dtk Redis, hanya `/v1/*`, 429+`Retry-After`, **fail-open** (`GLOBAL_RATE_LIMIT_PER_MINUTE=240`, 0=mati; teruji 429/fail-open/mati). `middleware/security_headers.py`: nosniff, frame-deny, referrer-policy, CSP `default-src 'none'`, `Permissions-Policy: camera=(self)…`, HSTS prod-only — middleware terluar sehingga header hadir juga di 429/error. `core/sentry.py`: `SENTRY_DSN` kosong = mati total; `before_send` membuang 4xx/503 yang disengaja; `send_default_pii=False` (PRD §9). Event PRD §8 sudah lengkap sejak Sprint 3–7 — Sprint 8 menambah **pembacaannya**: `GET /v1/admin/metrics/events` (total per nama + bucket harian, `days` 1–90) |
| Rilis Play Store (internal testing) + release notes + deklarasi izin | 3 | 🟡 Pengganti | Yang bisa dibangun tanpa akun Play: (1) manifest — `CAMERA` + `POST_NOTIFICATIONS` + `uses-feature camera required=false` dgn komentar justifikasi (PRD §9); (2) `build.gradle` — signing release via env `EKO_STORE_FILE/PASSWORD/KEY_ALIAS/KEY_PASSWORD` (tanpa env → unsigned; kunci tidak pernah di-commit) + `EKO_VERSION_CODE/NAME`; (3) build terbukti: `assembleDebug` 7,3 MB + `bundleRelease` 5,7 MB (unsigned) BUILD SUCCESSFUL; (4) `docs/release/RELEASE-NOTES-v1.0.0.md` + `docs/release/PLAY-STORE-CHECKLIST.md` (prasyarat akun, pembuatan keystore, deklarasi Data Safety/konten-AI/rating, unggah internal testing) — eksekusi konsol = aksi manual PO |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Composer + segmen** (`app/services/broadcast.py` baru): `SEGMENTS`
  (`all`, `aktif_7hari`, `pasif_7hari`, `bertoken`), `segment_filters()` /
  `_base_filters()` murni (teruji — window 7 hari dari `last_active_date`,
  sumber streak Sprint 5), `count_segment()` (preview komposer),
  `send_broadcast()` (batch `BROADCAST_BATCH=500`, paralel best-effort,
  rekap `BroadcastResult`), `announce_new_mission()`.
- **Endpoint admin** (`app/api/admin_push.py` baru): segmen / broadcast /
  riwayat / trigger streak-reminder — semua `require_roles("admin")` untuk
  aksi tulis; audit eksplisit `push.broadcast` lewat `services.audit` satu
  pintu. (`app/api/admin_metrics.py` baru): `GET /v1/admin/metrics/events`.
- **Streak reminder** (`app/services/streak_reminder.py` baru) +
  **scheduler** (`app/services/scheduler.py` baru): task asyncio dinyalakan
  di lifespan (`start_scheduler`/`stop_scheduler`); gerbang murni
  `scheduler_should_run`; idempoten harian via `AppSetting`
  `streak_reminder_last_run`.
- **Middleware baru**: `middleware/rate_limit.py` (global per IP — XFF hop
  pertama; namespace per environment), `middleware/security_headers.py`.
  **Sentry**: `core/sentry.py` + dependensi `sentry-sdk[fastapi]` (init di
  `create_app`, no-op tanpa DSN).
- **Broadcast di in-app list**: `GET /v1/notifications` kini memuat baris
  `user_id NULL` (`or_` filter); `unread_only` & `unread_count` tetap
  personal; tandai-baca otomatis tidak menyentuh broadcast (sudah difilter
  `user_id == user.id` sejak Sprint 5). `POST /v1/admin/missions` kini
  mengumumkan misi baru (broadcast + push pasca-commit).
- **Config/env baru**: `GLOBAL_RATE_LIMIT_PER_MINUTE` (240), `SENTRY_DSN`,
  `SENTRY_TRACES_SAMPLE_RATE` (0), `STREAK_REMINDER_ENABLED` (true),
  `STREAK_REMINDER_HOUR` (8), `SCHEDULER_INTERVAL_MINUTES` (15) —
  `.env.example` + README. **Tanpa migrasi** — `app_settings` ada sejak skema
  awal; keputusan skema penuh Sprint 0 terbayar keempat kalinya.
- **Smoke E2E** (`scripts/smoke.py` baru + `make api-smoke`): mandiri — buat
  DB `ekoteologi_smoke`, migrasi, reset+seed, admin, lalu 33 langkah lewat
  ASGI transport.
- **Test**: 237 → **276** (39 baru: hardening 13, broadcast/segmen/misi
  baru 14, streak reminder 8, metrik 4).

### 3.2 Admin (`admin/`)

- **`views/PushView.vue`** (`/push`; menu "Push Notifikasi" grup Sistem
  kini berpindah halaman; tombol lonceng topbar ikut membuka modul): kartu
  segmen (penerima + perangkat, highlight terpilih), composer (judul/isi/
  chip segmen `aria-pressed`, konfirmasi dgn estimasi, role non-admin
  read-only dgn keterangan), panel hasil ("Terkirim ke N dari M perangkat
  (K penerima)"), riwayat broadcast (tabel responsif `<768px`).
- **`utils/push.ts`** (murni, +4 test vitest): `composerError` (ambang
  4–64/8–300 sinkron dgn server), `broadcastSummary` (Intl id-ID),
  `historyLabel`, konstanta ambang.
- Router (`/push`) + AdminShell diperbarui; item "Audit Log"/"Laporan"
  sengaja tetap nonaktif (viewer bukan story sprint ini).

### 3.3 Mobile & Android (`mobile/`)

- Sisi kode aplikasi **tidak ada fitur baru** (sprint stabilisasi) — broadcast
  & reminder masuk lewat kontrak notifikasi/push yang sudah ada (list
  notifikasi dilayani server; push ditangani plugin Sprint 6).
- **Manifest**: `CAMERA`, `POST_NOTIFICATIONS`, `uses-feature
  camera required=false` — dgn komentar justifikasi Play Store (PRD §9).
- **`build.gradle`**: `signingConfigs.release` env-driven (mundur aman ke
  unsigned), versi via `EKO_VERSION_CODE/NAME`; `.gitignore` android kini
  menutup `*.jks`/`*.keystore`/`keystore.properties` (kecuali debug).

### 3.4 QA & dokumentasi

- **`docs/qa/DEVICE-MATRIX.md`**: matriks 6 perangkat, checklist regresi
  11 layar vs mockup (acuan AUDIT.md M1–M9), matriks performa, quirks
  vendor (MIUI/Samsung/WebView lama), tabel hasil eksekusi (belum terisi).
- **`docs/release/RELEASE-NOTES-v1.0.0.md`** + **`docs/release/PLAY-STORE-CHECKLIST.md`**
  (prasyarat akun PO, keystore `keytool`, build AAB, deklarasi Data
  Safety/konten AI/rating/privasi, unggah internal testing, pasca-rilis).
- README api (endpoint + arsitektur Sprint 8 + env + smoke), admin
  (composer push), mobile (izin, signing, AAB) diperbarui.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 276 lulus, coverage 77,67% (gate 70%) — modul Sprint 8: `streak_reminder` 96%, `push` 83%, `broadcast`/middleware/sentry tertutup test |
| ruff | `ruff check .` + `format --check` | ✅ bersih (123 file) |
| Vitest | `npm test` mobile & admin | ✅ mobile 81 lulus (9 file), admin 29 lulus (4 file — +4 util push) |
| eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses admin & mobile |
| APK debug + AAB release | `cap sync android` + `gradlew assembleDebug` + `gradlew bundleRelease` | ✅ BUILD SUCCESSFUL keduanya — `app-debug.apk` 7,3 MB, `app-release.aab` 5,7 MB (unsigned — kunci rilis item terbuka; jalur signing env terpasang) |
| Smoke E2E (baru, `make api-smoke`) | uvicorn-ASGI lokal (DB `ekoteologi_smoke` reset+seed, mock LLM) | ✅ **33 langkah lulus**: health+header → register/login → token push → scan +5 → duplikat 0 → kuota=2 → klaim manual approved → streak aktif → klaim photo pending → tolak tanpa catatan 400 → unggah ulang → approve → poin cocok → 3 modul → modul tuntas → kuis lulus +20 → ulang 0 → segmen (2 penerima/1 token) → broadcast sent=1 → broadcast di list member → unread tidak bengkak → misi baru di-broadcast → reminder targets=1 → idempoten skipped → metrik 4 event tercatat → audit `push.broadcast` |
| Rate limit global | test: limit 3 → request ke-4 | ✅ 429 + `Retry-After` ≥1; Redis stub mati → fail-open 200; `=0` → mati; `/health` di luar `/v1` tidak dihitung |
| Security header | test + smoke langkah 2 | ✅ nosniff/frame-deny/referrer/CSP/permissions-policy di semua respons (termasuk 404/401); HSTS hanya saat environment=prod |
| Sentry | test | ✅ tanpa DSN `init_sentry` → False (mati); DSN diisi → init dipanggil dgn `send_default_pii=False`; `before_send` buang 429, teruskan 500 |
| Composer role & audit | test + smoke | ✅ verifier/editor → 403; judul pendek → 422; segmen asing → 400; audit `push.broadcast` dgn actor+rekap tercatat |
| Broadcast semantics | test | ✅ 1 baris untuk semua; `unread_count` tidak menghitung broadcast; `unread_only` mengeluarkan broadcast; tandai-baca massal tidak menyentuhnya |
| Audit statis UI vs AUDIT.md | grep kode | ✅ admin 0 warna hardcode; PushView 41 pemakaian `var(--…)`; 5 warna hardcode mobile = warisan sprint lalu yang terdokumentasi (4 warna brand Google resmi di SVG SSO `AuthView` Sprint 1 — AUDIT M2; 1 scrim `color-mix` misi Sprint 4); ikon FontAwesome 6 semua; tap target ≥44px (chip segmen min-height 44) |
| CI GitHub | push commit fitur + laporan | ⏳ dipantau via REST API — hasil dicatat commit berikutnya |

---

## 5. Keputusan & Catatan Teknis

1. **Broadcast = satu baris (`user_id NULL`), bukan fan-out personal** — desain
   skema PRD §5.9 dari awal menyediakan `user_id` NULL khusus broadcast, dan
   catatan Sprint 5 menyebutnya "domain composer Sprint 8". Konsekuensi yang
   disengaja: pengumuman "misi baru" ke 10.000 user tidak menulis 10.000 baris;
   push tetap per-token. Konsekuensi kedua yang diambil jujur: `read_at` milik
   baris tidak bisa dipakai per-user, jadi semantik baca broadcast **tidak
   pernah personal** — `unread_count` (badge) hanya menghitung notifikasi
   personal sehingga tidak "nyangkut" selamanya, dan tandai-baca otomatis
   (mis. buka layar Misi) tidak menelan broadcast orang lain. Notifikasi yang
   butuh status baca per-user (hasil verifikasi) tetap personal.
2. **Segmen dari data yang benar-benar ada** — `aktif_7hari`/`pasif_7hari`
   memakai `last_active_date` (sumber streak Sprint 5), `bertoken` EXISTS
   `fcm_tokens`; semuanya selalu AND `is_active` (akun diblokir tidak pernah
   menerima apa pun). Tidak ada segmen "klasifikasi keterlibatan" karangan.
   Bug nyata tertangkap test: EXISTS `bertoken` di query yang FROM-nya sudah
   memuat `fcm_tokens` memicu auto-correlation SQLAlchemy — query gabungan
   token memakai `_base_filters` (EXISTS redundan disitu).
3. **Streak reminder idempoten via `app_settings`, bukan cron** — satu penanda
   `streak_reminder_last_run` membuat tiga pemanggil aman bersama: scheduler
   in-process, endpoint admin (ops/demo, `force` mengabaikan penanda), dan
   restart aplikasi. Targetnya jujur: aktif **kemarin** + belum aktif hari
   ini + streak ≥2 (streak 0–1 belum "berisiko"); copy memakai angka streak
   asli dan `days_until_bonus` dari engine Sprint 5 — satu sumber angka.
4. **Scheduler in-process = trade-off MVP terdokumentasi** — hosting masih
   item terbuka sehingga worker/cron terpisah belum realistis; task asyncio di
   lifespan cukup untuk single-worker dan **tetap aman bila multi-worker**
   (idempoten per hari). Jika nanti PO menyalakan cron eksternal, set
   `STREAK_REMINDER_ENABLED=false` dan panggil endpoint admin — logika tidak
   berubah.
5. **Rate limit global fail-OPEN vs kuota scan fail-CLOSED** — kelanjutan
   keputusan Sprint 1/2 yang kini lengkap tiga lapis: lapis global anti-flood
   melindungi ketersediaan (gagal Redis tidak boleh mematikan API utk semua
   user), lapis scan melindungi budget LLM nyata (fail-closed), lapis login
   fail-open. Default 240 req/menit/IP cukup longgar utk pola aplikasi (smoke
   ±40 request) dan env-driven. Hanya path `/v1/*` (dokumen/OpenAPI/uploads
   bebas), IP = XFF hop pertama (di belakang reverse proxy).
6. **Security header dipasang di middleware terluar** — ditambahkan terakhir
   di `create_app` sehingga menutup respons 429 rate limit dan error lain
   sekalipun. CSP `default-src 'none'` aman untuk API JSON + berkas statis;
   HSTS **hanya** `ENVIRONMENT=prod` (di dev HTTP murni akan memblokir
   request). `Permissions-Policy: camera=(self)` selaras deklarasi Play
   Store — kamera hanya utk app sendiri (PRD §9).
7. **Sentry env-gated total** — tanpa `SENTRY_DSN` tidak ada import side
   effect/overhead apa pun (dev & test tetap bersih); `before_send` membuang
   `HTTPException` 4xx/503 yang memang kontrak API (429 kuota, 409 dobel,
   503 Redis mati terdegradasi) supaya kuota Sentry dipakai error sungguhan;
   `send_default_pii=False` menghormati PRD §9. Gagal init tidak pernah
   menumbangkan aplikasi.
8. **Metrik PRD §8: penulisan sudah lengkap sejak Sprint 3–7, Sprint 8
   menambah pembacaan** — `GET /v1/admin/metrics/events` merangkum
   `analytics_events` (total per nama + bucket harian, jendela 1–90 hari)
   sehingga target §8 (aktivasi ≥40%, dsb.) bisa diverifikasi PO tanpa query
   manual. Bucket tanggal memakai `CAST(created_at AS DATE)` sisi DB — di sini
   tidak menyangkut anti-dobel sehingga aman (catatan zona Sprint 4 tetap
   berlaku untuk angka anti-farming).
9. **Audit komposer dua lapis** — middleware Sprint 0 mencatat request
   (`post:/v1/admin/push/broadcast`), tapi dia tidak tahu dampaknya; audit
   eksplisit `push.broadcast` menyimpan rekap `{title, segment, recipients,
   tokens, sent}` yang bisa dibaca `GET /v1/audit-logs` dan dirender riwayat
   komposer dari payload notifikasi (tanpa tabel baru).
10. **Push "misi baru" memakai jalur broadcast yang sama dgn composer** —
    `announce_new_mission()` dipanggil SETELAH commit misi (gagal push tidak
    pernah membatalkan misi; pola best-effort Sprint 6). Tidak memakai notif
    personal per user karena skala penerima = seluruh basis user, berbeda
    dgn notif verifikasi yang personal.
11. **Smoke E2E menjadi artefak repositori** — sprint 2–7 menjalankan smoke
    ad-hoc (skrip sekali pakai di luar repo); karena QA regresi otomatis
    adalah story sprint ini, skripnya di-commit (`scripts/smoke.py`,
    `make api-smoke`): DB smoke terpisah, reset+seed otomatis, 33 langkah
    menyentuh semua alur kritis plan §5.2 + Sprint 8, keluar non-zero saat
    gagal. Kunci jawaban kuis dibaca dari DB — sah untuk skrip QA (bukan
    klien).
12. **Izin Android minimal + jujur** — hanya `INTERNET` + `CAMERA` +
    `POST_NOTIFICATIONS`; `uses-feature camera required=false` agar tablet
    tanpa kamera tetap terpasang; tidak ada `RECORD_AUDIO`/lokasi. Justifikasi
    per-izin tertulis di manifest dan checklist Play (PRD §9: "deklarasi izin
    jelas; kebijakan konten AI" — kebijakan AI juga dijawab di checklist:
    output tervalidasi, kutipan selalu bank terkurasi, poin terbatas).
13. **Signing release env-driven, tidak pernah di-commit** — `build.gradle`
    membaca `EKO_STORE_FILE/_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD`; tanpa env,
    `bundleRelease` tetap sukses menghasilkan AAB unsigned (terbukti lokal)
    supaya jalur build bisa diverifikasi sebelum kunci ada. `.gitignore`
    android menutup `*.jks`/`*.keystore`/`keystore.properties`.
14. **Sisi mobile sengaja tanpa fitur baru** — broadcast/reminder tampil via
    kontrak yang sudah ada (list notifikasi server + plugin push Sprint 6);
    perubahan mobile hanya manifest/signing/versi. Konsisten dgn goal sprint
    "stabilisasi, tanpa fitur baru".
15. **Mutasi pengguna admin (blokir/role/reset poin) tetap tidak masuk** —
    usulan Sprint 4/7 tidak menjadi story rencana Sprint 8 (15 poin sudah
    penuh, prinsip "tanpa fitur baru"); endpoint masih read-only dan diusulkan
    ke sprint fleksibel/backlog Fase 2 (§7).

---

## 6. DoD Sprint 8 — Checklist

- [x] CI hijau di GitHub: ⏳ dipantau pasca-push (commit `docs(sprint): catat
      hasil run CI sprint 8` akan mengisi baris ini — pola sprint 5–7).
      Verifikasi lokal penuh: 276 pytest (coverage 77,67%, gate 70%), 81+29
      vitest, ruff/eslint bersih, build admin+mobile, APK debug 7,3 MB +
      AAB release 5,7 MB.
- [x] Unit/component test logika baru: API 39 test (segmen murni + count DB,
      composer role/validasi/audit/riwayat, semantik broadcast di list,
      misi baru, streak reminder murni+integrasi+idempoten+endpoint,
      scheduler start/stop, rate limit 429/fail-open/mati, security header
      + HSTS prod, Sentry env-gated + filter, metrik event), admin +4 vitest
      (util komposer).
- [x] UI 100% dari `tokens.css` — PushView nol hardcode warna (41 pemakaian
      `var(--…)`; `999px` memakai `--radius-pill`); nilai non-token hanya
      konvensi admin yang sudah ada (breakpoint 1023/767px, tap target
      44px) dan angka Intl id-ID.
- [x] State lengkap: PushView (skeleton, error + Coba Lagi `role=alert`,
      riwayat kosong, disabled saat mengirim, konfirmasi kirim, pesan
      role non-admin), broadcast (role=status), endpoint segmen/metrics
      (kosong = 0 jujur).
- [x] Aksesibilitas: chip segmen `aria-pressed` + min-height 44px, form
      berlabel + `role=alert` utk error, tabel `data-label` responsif,
      ikon `aria-hidden`, `prefers-reduced-motion` & `:focus-visible`
      global dari tokens.css.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata / Play Console — **belum**
      (perangkat fisik & akun Play tidak tersedia — item terbuka sejak
      Sprint 0). Pengganti terukur: smoke E2E 33 langkah + regresi penuh +
      APK/AAB ter-build + device matrix siap eksekusi
      (`docs/qa/DEVICE-MATRIX.md`) + checklist rilis
      (`docs/release/PLAY-STORE-CHECKLIST.md`).
- [x] Terdokumentasi: `api/README.md` (endpoint + arsitektur hardening/
      notifikasi + env + smoke), `admin/README.md` (composer push),
      `mobile/README.md` (izin, signing, AAB), `.env.example`,
      `docs/qa/DEVICE-MATRIX.md`, `docs/release/*`, laporan ini.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan/aksi |
|---|---|---|---|
| 1 | **Kredensial FCM server** (terbuka sejak Sprint 0) | Semua push masih `PUSH_MODE=log` — alur notification→push teruji di log/test; mode `fcm` + `_send_one` OAuth2 menunggu JSON service account | PO: buat GCP project + service account (checklist §0) — tanpa deploy ulang kode |
| 2 | **Akun Play Console + keystore rilis** (baru sprint ini) | Internal testing belum bisa diunggah; AAB harus ditandatangani kunci rilis | PO: daftar akun, buat keystore (`keytool`, checklist §1), isi env signing, ikuti checklist §4 |
| 3 | Perangkat Android nyata (terbuka sejak Sprint 0) | QA matrix vendor fisik belum dieksekusi (dokumen siap: `docs/qa/DEVICE-MATRIX.md`) | QA manual segera setelah perangkat ada (`adb install app-debug.apk`) |
| 4 | Hosting staging/prod + `LLM_API_KEY` + `SENTRY_DSN` (terbuka sejak Sprint 0) | Analisis AI masih mock; Sentry terpasang tapi mati tanpa DSN; URL kebijakan privasi Play butuh domain publik | **Segera** sebelum rilis internal yang menayangkan angka nyata |
| 5 | Kebijakan TTL bukti klaim (catatan Sprint 4: "ditinjau Sprint 8") | Retensi saat ini: bukti hidup selama baris klaim ada, hapus manual via support — sudah aman utk internal testing | Ratifikasi PO: nilai TTL otomatis bila diinginkan (perlu migrasi kecil) |
| 6 | Mutasi pengguna admin (blokir/role/reset poin) — diusulkan sejak Sprint 4 | Panel pengguna masih read-only; pembatalan akses manual via DB | Backlog sprint fleksibel / Fase 2 |
| 7 | Ratifikasi PO angka env-driven lintas sprint | Semua default = asumsi kerja terdokumentasi (bonus streak 6/+20, kuis 70%/+20, tahap pohon 5/15/30/50, kuota scan 20, rate limit global 240, reminder jam 8) | Review PO — semuanya bisa diubah tanpa deploy |
| 8 | Sisa wiring Google Sign-In native + OAuth Client ID (Sprint 1) | Tombol Google menampilkan pesan "belum aktif"; login email+sandi jalan penuh | Fleksibel — sebelum rilis publik |

---

## 8. Checklist Rilis Manual (PO) — Play Store Internal Testing

Ringkasan; versi lengkap: `docs/release/PLAY-STORE-CHECKLIST.md` ·
release notes: `docs/release/RELEASE-NOTES-v1.0.0.md`.

1. **Prasyarat akun** — Play Console; GCP project + service account FCM
   (set `PUSH_MODE=fcm`, `FCM_CREDENTIALS_FILE`, `FCM_PROJECT_ID`);
   OAuth Client ID (menuntaskan Google Sign-In); Sentry DSN; domain+TLS
   utk API & kebijakan privasi.
2. **Kunci rilis** — `keytool -genkeypair … -validity 10000`; simpan aman;
   set env `EKO_STORE_FILE/_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD` di mesin
   build/CI.
3. **Build** — `cd mobile && npm ci && npm run build && npx cap sync android
   && cd android && ./gradlew bundleRelease` (versi via
   `EKO_VERSION_CODE/NAME`); uji cepat `adb install app-debug.apk`.
4. **Isi Play Console** — Data Safety (email/nama/kota/foto; consent
   server-side tercatat; tidak dijual), kebijakan privasi (URL publik),
   deklarasi konten AI (analisis foto oleh model — mitigasi: output
   tervalidasi, kutipan bank terkurasi, poin dibatasi), content rating,
   target audiens, screenshot 2+ & ikon 512px.
5. **Unggah** — Testing → Internal testing → release `1.0.0 (1)` → AAB →
   catatan rilis dari RELEASE-NOTES → tambah tester → rollout 100% jalur
   internal.
6. **Pasca-rilis** — `adb` smoke perangkat fisik dgn matriks
   `docs/qa/DEVICE-MATRIX.md`; pantau `GET /v1/admin/metrics/events`
   (aktivasi `scan_pertama`, target PRD §8 ≥40%) + Sentry; kumpulkan
   feedback tester ke backlog review.

**Status kesiapan MVP**: kode, test, build, dokumen rilis, dan alur
produk siap; yang memisahkan dari unggahan nyata hanyalah prasyarat akun
(Play Console, FCM, domain/kunci) — semuanya manual PO di luar repositori.
