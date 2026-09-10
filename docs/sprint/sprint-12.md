# Laporan Sprint 12 — Misi, Verifikasi & Gamifikasi

> Periode: 10 September 2026 · Kapasitas: 13 poin · Status: **selesai — 7/7 story
> diterima (13/13 poin)** · Goal sprint: *Loop misi tertutup di PocketBase:
> klaim → verifikasi → poin + notifikasi; level, streak, badge hidup.*
> Catatan jujur: uji sentuh perangkat Android nyata tetap menunggu APK
> internal testing (Sprint 13 QA — catatan sama dgn Sprint 10/11); pengiriman
> push FCM atas notifikasi menyusul Sprint 13 (notif in-app sudah jalan).

---

## 1. Ringkasan

Sprint keempat migrasi (implementation-plan §4 Epic B4). Loop misi kini
tertutup penuh di PocketBase dan seluruh "menunggu Sprint 12" dari laporan
Sprint 10–11 tuntas:

- **Klaim** lewat route hook `POST /api/ekoteologi/missions/{id}/claim`
  (`pb_hooks/gamification.pb.js`): mode `photo` (bukti + consent divalidasi
  server — PRD §9), `manual` (**auto-approve**: poin lewat ledger append-only,
  notifikasi, streak, badge — dalam satu transaksi), `auto_scan` ditolak saat
  diklaim manual (400 — progres dihitung dari scan). Periode klaim
  (`daily`/`weekly`/`special`), jendela `start_at`–`end_at`, dan anti dobel
  semuanya server-side.
- **Verifikasi**: PATCH `user_missions` kini hanya untuk staff — approve
  otomatis memberi poin misi lewat ledger (`points_awarded` & `reviewed_by/at`
  dipaksa server; klien tidak bisa menetapkan poin), notifikasi in-app, event
  `misi_selesai`, streak berdetak, badge on-event; reject mewajibkan catatan
  dan menotifikasi user. Layar Verifikasi admin tersambung penuh (tinggal
  kirim `status` + `review_note`).
- **Gamifikasi hidup**: level engine di hook ledger (recalc
  `users.level`/`level_title` dari `levels.min_points` setiap poin berubah),
  streak harian di hook (reset lazy, bonus kelipatan env-driven, cron
  reminder `cronAdd`), dan badge engine (kriteria JSON → evaluasi on-event +
  lazy).

Koleksi `user_missions` ikut dikunci dari tulisan klien (createRule dihapus,
updateRule staff) — paritas keamanan jalur scan Sprint 11: klaim hanya lahir
lewat route, keputusan hanya lewat staff.

Bukti cepat (kriteria demo goal — "klaim bukti → verifikasi admin → poin +
level + badge + notif masuk"):

| Kriteria demo | Hasil |
|---|---|
| Klaim bukti di perangkat | ✅ E2E SDK: klaim photo via route (FormData `proof`+`consent`) → `submitted`, consent tercatat server, bukti tersimpan; anti dobel → 409 ramah (`pocketbase/scripts/e2e-sdk.mjs` §6). Uji sentuh perangkat asli menunggu APK internal testing (Sprint 13) |
| Verifikasi admin | ✅ E2E: tolak tanpa catatan → 400; approve → `points_awarded=8` dipaksa server, `reviewed_by` = verifier |
| Poin + level | ✅ E2E: `authRefresh` → users.points 15+8=23 (ledger tersinkron); `users.level=1` + `level_title` terisi engine; pb-test §10: 561 poin → **level 5 "Aktivis Lingkungan"** otomatis |
| Badge | ✅ E2E: `GET /api/ekoteologi/badges` → `misi_pertama` earned setelah approve; pb-test: `scan_pertama` dari scan, `poin_1000` terbayar lazy setelah penyesuaian admin, `streak_7` dari rekor longest |
| Notif masuk | ✅ E2E & pb-test: "Misi disetujui!", "Misi perlu diperbaiki", "Bonus streak 6 hari!", "Lencana baru: …", "Streak N hari berisiko!" (cron) semuanya terbaca user |

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| CRUD misi admin (periode, poin, mode verifikasi) — via API koleksi + rules | 2 | ✅ | UI admin sudah ada sejak FastAPI era & tersambung API koleksi sejak Sprint 10; Sprint 12 melengkapi: `verification` divalidasi skema select (nilai asing → 400), **DELETE misi yang punya klaim ditolak 409** dgn pesan ramah (guard hook — jaga riwayat, paritas `admin_missions.py`), antrian klaim di layar Misi kini benar-benar terisi (klaim via route memakai status `submitted`). CRUD lewat rules: tulis admin, publik baca aktif — teruji (user biasa buat misi → ditolak). |
| Klaim misi: photo (file + consent), auto_scan (progres dari scan), manual (auto-approve) | 3 | ✅ | Route `POST /missions/{id}/claim`: **photo** — consent wajib (400), bukti wajib + ukuran `MISSION_IMAGE_MAX_MB` (413) + magic bytes (400), status `submitted`, `consent_at` server; **manual** — auto-approve + ledger + notifikasi + event + streak + badge satu transaksi (`runInTransaction`); **auto_scan** — 400 saat diklaim manual; progres hidup di hook create `scans`: hanya scan bernilai poin yang maju (anti poin-farming), filter `scan_category` (kosong = semua), target `required_count` → auto-approve + poin. Klaim `rejected` boleh diulang — baris sama dipakai ulang (unique index tetap terjaga). |
| Anti dobel klaim: unique index + hook validasi periode | 1 | ✅ | Index `(user, mission, period_date)` dibuat Sprint 9 — kini perilakunya utuh: periode dihitung server (`daily`/`special` = hari ini; `weekly` = Senin — teruji via superuser read), pre-check → 409 berbahasa Indonesia ("sudah diklaim — menunggu verifikasi" / "sudah selesai untuk periode ini"), balapan serentak ditangkap index → 409, dan create langsung via API koleksi ditolak (createRule dihapus migrasi). |
| Antrian verifikasi admin → ledger + notif in-app | 2 | ✅ | updateRule staff + guard hook request: hanya verifier/admin; hanya transisi `submitted→approved|rejected`; `points_awarded` dipaksa = points misi (klien tak bisa menetapkan), `reviewed_by`=pemeriksa, `reviewed_at` server; reject tanpa `review_note` → 400. Engine di hook model: approve → baris ledger `source=mission` (hook ledger menyinkron `users.points` + level) + notifikasi "Misi disetujui!" + event `misi_selesai` + streak + badge; reject → notifikasi "Misi perlu diperbaiki". Review ulang → 409. Verifier melihat antrian `submitted` + expand (rule staff, teruji). |
| Level engine hook (recalc saat ledger bertambah) | 1 | ✅ | Hook create `point_transactions` (Sprint 11) diperluas: setelah sinkron `users.points`, tangga `levels` diurut dan `users.level`/`level_title` dihitung ulang (level tertinggi dgn `min_points <= poin`) — satu save. Field baru via migrasi `1757600000_gamification_bootstrap.js` + backfill user lama. Teruji: 10 poin → level 1 "Pemula"; 561 → level 5 "Aktivis Lingkungan". |
| Streak harian hook (reset, bonus) + cron reminder | 2 | ✅ | `touchStreak` di tiga titik aktivitas bernilai (scan bernilai poin, klaim manual, approve misi): idempoten per hari, reset lazy (bolong 3 hari → kembali 1 — teruji), bonus ledger `source=streak` tiap kelipatan `STREAK_BONUS_EVERY_DAYS` × `STREAK_BONUS_POINTS` (default 6×20 — teruji: streak 5→6 → +20 + notif "Bonus streak 6 hari!" + event `streak_hari`; aktivitas kedua di hari sama tidak menggandakan). Cron `cronAdd("ekoteologi_streak_reminder")` (env `STREAK_REMINDER_CRON`) menulis notif "Streak N hari berisiko!" utk user aktif kemarin (idempoten per hari via guard `app_settings`); trigger manual route admin + `GET /api/ekoteologi/streak` (status efektif + kalender 7 hari dari ledger + konfigurasi bonus server-driven). |
| Badge engine hook (kriteria JSON → evaluasi event scan/klaim/streak) | 2 | ✅ | `syncBadges`: statistik (scan bernilai, misi approved, rekor streak, total poin ledger, kuis lulus) vs kriteria `{"type","value"}` — 10 badge seed hidup. On-event: scan bernilai (dgn delta transaksi), approve, klaim manual; **lazy** di `GET /api/ekoteologi/badges` (paritas `GET /v1/badges` FastAPI) — lencana tetap terbayar dari jalur non-event (penyesuaian admin → `poin_1000` teruji). Idempoten (unique index + owned-check), fail-closed (kriteria korup ≠ diraih), notifikasi per lencana baru. |

## 3. Yang Dibangun

### 3.1 `pocketbase/` (backend)

- **`pb_hooks/gamification.pb.js`** (baru) — route klaim, `GET /badges`
  (lazy sync + daftar), `GET /streak`, cron reminder + route trigger manual,
  guard + engine review (`user_missions`), hook progres auto_scan +
  streak + badge (`scans`), proteksi hapus misi.
- **`pb_migrations/1757600000_gamification_bootstrap.js`** — field
  `users.level`/`level_title` (+ backfill), kunci `user_missions`
  (createRule dihapus, updateRule staff).
- **`pb_hooks/scan.pb.js`** — hook ledger diperluas: recalc level dalam save
  yang sama dgn sinkron poin.
- **`pb_hooks/main.pb.js`** — versi ping `0.1.0-sprint12`.
- **`scripts/test.mjs`** — 98 → **171 aserti** (§4 ditulis ulang utk klaim
  via route; §6 audit klaim; §9 poin awal; §10 baru: klaim 3 mode + validasi,
  anti dobel, antrian + reject/approve engine, weekly period, auto_scan
  (logam/kategori/duplikat), streak reset+bonus+idempoten+route, level engine,
  badge on-event+lazy, cron reminder, proteksi hapus).
- **`scripts/e2e-sdk.mjs`** — 26 → **35 asersi** (§5 klaim manual via route +
  level, §6 klaim photo → antrian → approve → poin/notif/badge/streak).
- **README + .env.example** — kontrak 4 route + hook sprint 12 + env
  `MISSION_IMAGE_MAX_MB`, `STREAK_BONUS_*`, `STREAK_REMINDER*`.

### 3.2 `mobile/`

- `services/missions.ts` — `claimPhoto`/`claimManual` pindah ke route hook
  (tidak ada lagi field klaim dari klien: periode/status/consent server-side);
  `fetchBadges` ke route lazy sync; `fetchMissions` kini **period-aware**
  (`my_claim` dipilih per periode berjalan — bukan sekadar klaim terbaru) dan
  ringkasan mingguan dari `period_date`.
- `services/streak.ts` — route `GET /api/ekoteologi/streak` (kalender dari
  ledger semua aktivitas bernilai + konfigurasi bonus server; konstanta klien
  pensiun).
- `types/mission.ts` — `ClaimResponse.points_total?`; `views/MissionsView.vue`
  — total poin dari respons server (`applyPoints`), copy konsisten.

### 3.3 `admin/`

- `views/VerificationView.vue` — PATCH hanya `status`+`review_note`
  (poin/`reviewed_by/at` dipaksa server), toast mencerminkan efek nyata.
- `views/MissionsView.vue` — catatan modul; hapus misi dgn klaim kini
  ditolak server dgn pesan ramah.

### 3.4 Infra

- Tidak ada perubahan compose/Dockerfile/Makefile/CI — job `backend`
  otomatis menjalankan lint JS (glob mencakup file baru), test 171 asersi,
  E2E SDK 35 asersi, smoke.

## 4. Keputusan Teknis (dan temuan penting v0.40/JSVM)

1. **Klaim via route hook, koleksi dikunci** (pola Sprint 11): periode,
   consent, status, dan auto-approve tidak mungkin dipalsukan klien. Resubmit
   setelah reject memakai baris yang sama (unique index tetap penentu).
2. **`$dbx.exp` TIDAK mengikat named params di JSVM v0.40** — ekspresi lewat
   mentah ("near &: syntax error"); **`.all()`/`.one()` dbx juga gagal**
   ("Invalid variable type: must be a pointer"). Statistik badge memakai
   `findRecordsByFilter` (binding params teruji) + agregasi di JS — volume
   baris per-user kecil utk skala MVP.
3. **Koneksi SQL terpisah dari transaksi hook**: baris yang baru ditulis
   dalam transaksi berjalan tidak terlihat oleh query `app.db()` — statistik
   badge dikompensasi parameter `delta` (baris scan/klaim/ledger yang baru
   dihitung manual). Teruji: `misi_pertama` langsung earned saat approve.
4. **Save lanjutan record baru dalam tx yang sama memicu `onRecordUpdate`
   dgn `original()` kosong** (terbukti empiris): guard transisi mengizinkan
   `old === ""` (tak mungkin lewat API — record API selalu punya status
   tersimpan) DAN loop progres auto_scan direstrukturisasi satu-save-per-klaim
   (klaim baru langsung disimpan dgn status finalnya).
5. **Efek di hook model SETELAH `e.next()` (jalur request) tidak di-rollback
   bila hook melempar error sesudahnya** — berbeda dgn `runInTransaction`
   eksplisit di route klaim/scan yang atomik (terbukti: kegagalan badge sync
   membuat PATCH approve 400 padahal poin sudah masuk). Mitigasi: ledger —
   efek paling kritis — dijalankan lebih dulu dan gagalnya dilempar; efek
   sisanya (notif/event/streak/badge) di-catch (badge telat ter-cover lazy).
6. **`createRule` kosong (deny) menyamarkan 403 menjadi 404** pada PATCH
   milik sendiri (PB tak membocorkan keberadaan record) — guard request tetap
   memasang 403 eksplisit utk non-staff yang lolos rule (mis. superuser host).
7. **Zona waktu**: tanggal tersimpan dlm dua konvensi — `period_date`/
   `last_active_date` = tanggal-lokal@UTC-tengah malam (slice bagian tanggal),
   `created` = UTC (dikonversi ke tanggal LOKAL utk kalender streak, paritas
   "jangan date() di sisi DB" FastAPI). Filter minggu memakai tengah malam
   lokal eksak (`toISOString()`), dan teruji lintas tengah malam (test
   dijalankan pukul 00:2x waktu server).
8. **Badge streak memakai rekor `longest_streak`** (paritas FastAPI — tidak
   pernah menurun); `quiz_passed` dihitung sekarang walau selalu 0 sampai
   e-learning hidup (Sprint 13) — lencana kuis otomatis terbuka tanpa
   menyentuh engine.
9. **Progres auto_scan hanya dari scan bernilai poin** (duplikat poin 0 tidak
   memajukan & tidak membuat baris progres — teruji; anti poin-farming PRD §9,
   paritas keputusan Sprint 2/5).
10. **Reminder cron idempoten per hari** via guard `app_settings`
    (`sr:{uid}:{tanggal}`, kunci < 50 char — temuan Sprint 11); trigger
    manual (route admin) dipakai test — pola paritas endpoint admin FastAPI.

## 5. Penyimpangan & catatan jujur

- **Uji sentuh perangkat Android nyata** menunggu APK internal testing
  (Sprint 13 QA) — alur klien terverifikasi via E2E SDK (jalur persis
  `pb.send` yang dipakai aplikasi).
- **Push FCM** atas notifikasi (approve/reject/bonus/reminder/lencana) belum
  terkirim — notifikasi in-app sudah ditulis hook; pengiriman nyata = Sprint
  13 (FCM HTTP v1 + composer). Realtime SSE juga Sprint 13 (notif dibaca
  polling seperti saat ini).
- **Efek review tidak full-atomik dgn save klaim di jalur PATCH** (temuan §4
  #5) — urutan mitigasi membuat risiko praktisnya kecil (ledger dulu; badge
  lazy self-heal); dicatat utk hardening Sprint 13.
- **Agregasi badge memuat baris per user ke memori JS** (paritas MVP; SUM SQL
  tak tersedia karena temuan §4 #2) — diamati di hardening Sprint 13.
- **Pembersihan kunci `app_settings` kedaluwarsa** (`sr:*`, `scan_quota:*`,
  `sd:*`, `login_guard:*`) tetap terjadwal Sprint 13 (catatan Sprint 11).
- **Leaderboard/`GET /v1/leaderboard`** belum di-port (Fase 2 di rencana —
  di-refine menjelang Sprint 13; index `users.points` + field level sudah
  siap).

## 6. Verifikasi (bukti lokal, semua lulus)

| Perintah | Hasil |
|---|---|
| `make pb-test` | **171 PASS / 0 FAIL** (2× beruntun) — termasuk §10: validasi klaim photo (consent/bukti/format/ukuran), anti dobel 3 jalur (route ×2 + API koleksi ditolak), antrian staff, reject tanpa catatan 400, review ulang 409, resubmit baris sama, approve poin dipaksa server + ledger + notif + event + streak + badge misi_pertama, klaim manual + points_total, weekly = Senin, auto_scan (progres 1/2→2/2, filter kategori Logam vs B3, duplikat tak memajukan), streak reset lazy + bonus 6×20 + idempoten + route streak (efektif + kalender + konfigurasi), level 10→1 Pemula & 561→5 Aktivis Lingkungan, badge lazy poin_1000 + terkunci misi_25/scan_10, cron reminder (terkirim, idempoten, admin-only), hapus misi 409/200 |
| `make pb-e2e` | **35 PASS / 0 FAIL** — jalur persis klien SDK: klaim manual route (auto-approve + poin authRefresh + level), anti dobel 409, klaim photo FormData (consent + bukti), antrian verifier expand + bukti, tolak tanpa catatan 400, approve (poin dipaksa, reviewed_by), poin 15+8=23 tersinkron, notif "Misi disetujui!", badge misi_pertama, streak route (aktif hari ini + kalender 7 hari + bonus_every_days), scan/riwayat/kuota tidak regresi |
| `make pb-smoke` | PASS `/api/health`, PASS `/api/ekoteologi/ping` (versi `0.1.0-sprint12`) |
| Lint JS backend | `node --check` semua `pb_hooks/*.pb.js`, `pb_migrations/*.js`, `scripts/*.mjs` |
| Admin | `npm run lint` ✅ · `npm run test` 29/29 ✅ · `npm run build` (vue-tsc + vite) ✅ |
| Mobile | `npm run lint` ✅ · `npm run test` 81/81 ✅ · `npm run build` ✅ |
| Pin versi | PocketBase v0.40.3 & SDK `pocketbase` 0.28.1 tidak berubah |

## 7. Blocker

Tidak ada blocker. Prasyarat eksternal lama tetap terbuka (tidak baru):
kredensial Google OAuth (Sprint 10 — graceful), uji sentuh perangkat asli
dan kredensial FCM (Sprint 13).

## 8. Hasil Run CI

| Run | Commit | Hasil |
|---|---|---|
| (diisi setelah push — lihat commit `docs(sprint)` berikutnya) | `4574454` (batch sprint 12) | — |

## 9. Ke Sprint 13

Loop misi & gamifikasi tertutup; sisa migrasi: e-learning + hook kuis
(anti dobel poin per modul — memakai ledger & badge engine yang sama),
konten harian cron publish, realtime SSE + FCM push (notif in-app sudah
diproduksi hook), agregasi dashboard admin (`$app.db`), pembersihan kunci
`app_settings` kedaluwarsa, QA cross-device + rilis.
