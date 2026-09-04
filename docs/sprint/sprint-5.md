# Laporan Sprint 5 — Misi: Verifikasi & Streak

> Periode: 5 September 2026 · Kapasitas: 12 poin · Status: **selesai — 6/6 story diterima
> (12/12 poin)** · Goal sprint: **Loop misi tertutup: klaim → verifikasi → poin +
> notifikasi; streak berjalan.**

---

## 1. Ringkasan

Loop misi kini tertutup penuh. Verifier membuka modul **Verifikasi Misi**
(`verifikasi.html`): bukti foto tampil besar di stage dengan strip antrian thumbnail
disebelahnya, panel detail menampilkan misi, pengguna (+kota), waktu unggah, catatan
user, sejarah klaim, dan badge consent — lalu memutuskan lewat tombol atau **keyboard
shortcut A (setujui) / R (tolak) / ←→ (pindah antrian)**. Menolak wajib disertai
catatan (diblokir di klien dan server). Setuju → poin misi masuk lewat ledger
append-only, `users.points` tersinkron, **notifikasi in-app** terkirim, event
`misi_selesai` (PRD §8) tercatat, dan **streak harian** user ikut berdetak — semuanya
dalam satu transaksi. User melihat hasilnya di layar Misi (chip "Menunggu/Selesai/
Perlu diperbaiki" + badge "N hasil verifikasi baru" di beranda).

Dua mode verifikasi yang tersisa Sprint 4 juga hidup: **manual** (tombol "Klaim Poin"
→ auto-approve, poin langsung masuk) dan **auto_scan** (tiap scan bernilai poin
menaikkan `progress_count`; target tercapai → approve otomatis dgn poin + notifikasi).
Gamifikasi bergerak: **level engine** disatukan menjadi satu modul murni (level, level
berikutnya, progres) dan **streak harian** jalan dengan reset lazy + bonus kelipatan
hari (env) yang mikrokonteksnya persis mockup `beranda.html`. Kartu streak di beranda —
api, judul "Streak N hari!", dan kalender 7 hari dari data ledger riil — menghidupkan
bagian signature `beranda.html`.

Bukti cepat (kriteria demo Sprint 5):

| Kriteria demo | Hasil |
|---|---|
| Klaim → verifikasi → poin + notifikasi | ✅ Smoke E2E 23 langkah: klaim photo → `pending` → reject dgn catatan → unggah ulang → approve → `points_awarded=50`, `users.points` 10→60, 3 notifikasi mission (`unread_count=3`), event `misi_selesai` ×3 di DB |
| Antrian verifikasi admin | ✅ `VerificationView` (`/verifikasi`) 1:1 mockup: preview besar + strip antrian (`role=listbox`), detail-list, A/R/←→ hotkey dgn guard input, catatan wajib saat tolak (klien + server 400) |
| Misi auto_scan (progres dari scan) | ✅ Smoke: 2 scan → `progress_count` 2/2 → `approved` +15 poin + notif "Misi selesai otomatis!"; scan duplikat (poin 0) tidak menghitung; filter `scan_category_id` teruji |
| Misi manual (auto-approve) | ✅ Klaim tanpa file/consent → 201 `approved` +10 poin lewat ledger + notif "Poin misi masuk" + event; dobel → 409 |
| Level engine | ✅ `services/levels.py` murni (resolve + next level + progres %) dipakai profil, admin users, dan respons review; profil kini memuat `next_level*` + streak |
| Streak berjalan | ✅ Smoke: klaim manual → `current_streak=1`, kalender 7 hari `week[-1].active=true`; idempoten di hari sama (scan ×2 = tetap 1); bonus kelipatan 6 teruji unit (ledger `streak` + notif + event `streak_hari`) |
| CI hijau | ✅ run #12 pada `b454c44` — 4/4 job hijau (api, admin, mobile, android-apk) — detail §6 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Antrian verifikasi admin (preview besar, A/R keyboard, catatan wajib saat tolak) | 3 | ✅ | `VerificationView.vue` (`/verifikasi`) 1:1 `verifikasi.html`: `verif-stage` preview bukti besar + `queue-strip` thumbnail (`role=listbox/option`), panel detail (pengguna, unggah, catatan user, sejarah "Misi ke-N", consent badge), `reviewError()` murni memblokir tolak tanpa catatan + fokus ke textarea, hotkey A/R/←→ (diabaikan saat fokus di input — pola mockup; didokumentasikan `kbd-row` aria-hidden). Role admin/verifier boleh memutuskan; editor read-only dgn keterangan. API: `POST /v1/admin/claims/{id}/review` + `user_claims_total` pada antrian |
| Notif hasil verifikasi (in-app; push menyusul Sprint 6) | 1 | ✅ | Tabel `notifications` (sudah ada sejak skema awal — tidak perlu migrasi) + endpoint `GET /v1/notifications` (`unread_count`, filter `type`/`unread_only`) + tandai dibaca (satu/semua). Chip status kartu misi kini hidup dari data; notifikasi `mission` ditandai dibaca saat daftar misi dibuka; kartu menu Misi di beranda menampilkan "N hasil verifikasi baru" |
| Misi auto_scan (progres dari scan, `progress_count`) | 3 | ✅ | `apply_scan_progress()` di `services/missions.py`: tiap scan bernilai poin (>0, bukan duplikat — anti poin-farming) menaikkan progres misi auto_scan aktif (filter `scan_category_id` bila diisi); baris `user_missions` dibuat lazily dgn SAVEPOINT anti-race (`IntegrityError` → ambil ulang pemenang); target `required_count` → approve otomatis (ledger + notif + event). Kartu progres 2/3 di `misi.html` hidup tanpa perubahan UI |
| Misi manual (auto-approve saat klaim) | 1 | ✅ | Endpoint klaim kini menerima mode `manual`: tanpa file/consent → `approved` seketika, `reviewed_at` terisi (sistem; `reviewed_by` NULL), poin lewat `award_points(source="mission")`, notif "Poin masuk", event `misi_selesai`, streak berdetak. Anti dobel & periode sama dgn photo; baris rejected dipakai ulang. Tombol "Klaim Poin" (btn-gold) kini fungsional dgn spinner per-kartu |
| Level engine (hitung dari poin) | 1 | ✅ | `services/levels.py` murni: `resolve_level()` (level tertinggi `min_points <= points` + `next_level/title/min_points` + `points_to_next`) & `level_progress_percent()`. Menggantikan logika ad-hoc tersebar di `profile.py` & `admin_users.py` (satu sumber — PRD §5.10 #2); `ProfileResponse` + `next_level*`, `current_streak`, `longest_streak` |
| Streak harian (reset, bonus) | 3 | ✅ | `services/streak.py`: `next_streak`/`effective_streak`/`days_until_bonus` murni (teruji), `touch_streak()` idempoten per hari (update streak/longest/last_active_date + bonus kelipatan via ledger `streak` + notif + event `streak_hari`), `GET /v1/streak` baca status + kalender 7 hari dari tanggal baris ledger. `StreakCard.vue` di beranda (api, judul, hint bonus, kalender inisial hari Indonesia, hari ini di-outline). Reset lazy: bolong ≥2 hari → tampil 0, aktif lagi mulai dari 1 |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Verifikasi** (`app/api/admin_verification.py` baru): `POST /v1/admin/claims/{id}/review`
  (admin|verifier) — `{decision, note?}`; approve → `award_points` + notifikasi +
  `track_event(misi_selesai)` + `touch_streak` (satu transaksi, commit tunggal);
  reject → `note` wajib (400), notifikasi memuat catatan, tanpa poin; 409 bila
  sudah direview; 404 klaim tak ada. Keputusan tercatat audit log (middleware).
- **Antrian diperkaya**: `GET /v1/admin/claims` kini memuat `reviewed_at` +
  `user_claims_total` (satu query terkelompok per halaman — bukan N+1) utk konteks
  "Sejarah" verifier.
- **Klaim manual & auto_scan** (`app/api/missions.py`, `app/services/missions.py`):
  `claim_mission` dipecah `_claim_photo`/`_claim_manual`; `auto_scan` → 400 dengan
  pesan "kerjakan lewat Scan". `apply_scan_progress()` diintegrasikan ke
  `POST /v1/scan` (hanya scan poin > 0), memakai `begin_nested` (SAVEPOINT) utk
  get-or-create baris progres anti race.
- **Streak** (`app/api/streak.py`, `app/services/streak.py`): `GET /v1/streak`
  (read-only — tidak menandai aktif) → `{current_streak efektif, longest_streak,
  active_today, last_active_date, bonus_points, bonus_every_days, days_to_bonus,
  week[7]}`; kalender dari tanggal `point_transactions` (`astimezone()` aplikasi —
  konsisten keputusan bucket Sprint 4). `touch_streak()` dipanggil di scan bernilai
  poin, klaim manual, dan approve verifier.
- **Notifikasi** (`app/api/notifications.py`, `app/services/notifications.py`):
  list milik sendiri (+`unread_count`), `POST /notifications/read` (semua/`ids`),
  `POST /notifications/{id}/read`; broadcast (`user_id` NULL) sengaja dikecualikan
  (domain FCM, Sprint 8).
- **Level engine** (`app/services/levels.py`): dipakai `profile.py` (respons kini
  +`next_level*`, `current_streak`, `longest_streak`) dan `admin_users.py`.
- **Metrik**: konstanta `EVENT_MISI_SELESAI`, `EVENT_STREAK_HARI` masuk
  `KNOWN_EVENTS` (`services/metrics.py`) — PRD §5.3 lengkap kecuali `modul_selesai`
  (Sprint 7).
- **Config/env**: `STREAK_BONUS_POINTS` (20), `STREAK_BONUS_EVERY_DAYS` (6; 0 = mati)
  — `.env.example` + README diperbarui. Tanpa hardcode.
- **Migrasi**: tidak ada — `notifications`, kolom streak, dan seluruh kolom misi
  sudah ada sejak skema awal (keputusan skema penuh Sprint 0 terbayar).
- **Test**: 134 → **175** (verifikasi 10, streak 8, level 7, manual 4, auto_scan 5,
  notifikasi 5; +1 test MissionCard-aset di sisi test photo).

### 3.2 Admin (`admin/`)

- **`views/VerificationView.vue`** (`/verifikasi`): seperti §2 — state lengkap
  (skeleton grid 2 panel, error + Coba Lagi `role=alert`, empty "Antrian selesai!"
  dgn hitungan sisa di server), auto-muat halaman pending berikutnya saat antrian
  halaman habis, toast hasil (nama user + poin / dinotifikasikan), badge SLA
  "1×24 jam" sesuai mockup, tombol disabled saat mengirim.
- **Router** + **AdminShell**: menu "Verifikasi Misi" kini berpindah halaman;
  panel "Klaim Masuk" di modul Misi jadi ringkasan + tombol "Buka Verifikasi".
- **`utils/verification.ts`** (murni, 6 test vitest): `reviewError` (catatan wajib),
  `claimSubtitle` ("Mingguan · verifikasi foto · +50 poin" — persis mockup),
  `historyLabel`, `formatUploaded` ("Hari ini, 09.12" / "Kemarin" / "1 Sep"),
  `nextIndexAfterRemove`.

### 3.3 Mobile (`mobile/`)

- **Klaim manual**: `services/missions.claimManual()` + `MissionCard` memancarkan
  `claim-manual` (spinner "Mengklaim…" per kartu via `busyId`); `MissionsView`
  mensinkronkan poin (`auth.addPoints` → profil disegarkan agar level ikut) lalu
  memuat ulang daftar.
- **Notifikasi in-app**: `services/notifications.ts` + `types/notification.ts`;
  hasil verifikasi ditandai dibaca saat daftar misi dibuka (chip kartu = permukaan
  notif); kartu menu **Misi** di beranda menampilkan "N hasil verifikasi baru".
- **StreakCard** (`components/home/StreakCard.vue`): pola `streak-card` mockup —
  lingkaran api (abu saat dingin), judul + hint dari `utils/streak.ts`, kalender 7
  hari (inisial Indonesia M/S/S/R/K/J/S, `on` = aktif, `today` = outline, `role=img`
  + `aria-label` berisi hitungan). Skeleton saat memuat; disembunyikan bila API
  gagal (pola best-effort beranda yang sudah ada).
- **`utils/streak.ts`** (murni, 8 test): `streakTitle`, `streakHint` (semua varian
  mikrokonteks, termasuk teks mockup "1 hari lagi untuk bonus +20 poin"),
  `dayInitial`, `streakAriaLabel`.
- **Auth store**: +`addPoints(delta)` dan +`refreshProfile()`; `ProfileData` +
  field opsional `next_level*`/`current_streak`/`longest_streak` (kompatibel).

### 3.4 Tooling & dokumentasi

- **Android**: toolchain Java dipin 21 + plugin `foojay-resolver-convention` di
  `settings.gradle` — lingkungan dev yang hanya punya JRE (tanpa `javac`) tetap
  bisa `gradlew assembleDebug` (JDK diunduh otomatis); CI tetap setup-java 21.
- README api (kontrak endpoint baru + arsitektur verifikasi/level/streak/notif),
  admin (modul Verifikasi), mobile (Sprint 5: verifikasi, manual/auto_scan,
  streak, notif) diperbarui.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 175 lulus, coverage 82,04% (gate 70%) |
| ruff | `ruff check .` + `format --check` | ✅ bersih |
| Vitest | `npm test` mobile & admin | ✅ mobile 49 lulus (6 file — +9 Sprint 5), admin 14 lulus (+6 util verifikasi) |
| eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses |
| APK debug | `./gradlew assembleDebug` | ✅ BUILD SUCCESSFUL (93 task; setelah pin toolchain Java 21 + foojay resolver — lingkungan lokal kini hanya punya JRE 25) |
| Smoke E2E Sprint 5 | uvicorn lokal (DB `ekoteologi_smoke`, mock LLM) + klien httpx | ✅ 23 langkah: register → buat 3 misi → klaim manual (+10, streak 1) → klaim photo → antrian + sejarah → tolak tanpa catatan 400 → tolak dgn catatan → unggah ulang → approve (+50; total 60; Lvl 2 dgn `next_level_points` 150) → notif 3 unread → tandai dibaca → 2 scan → auto_scan 2/2 approved (total 84) → streak tetap 1 (idempoten) |
| Bukti DB event & notif | query `ekoteologi_smoke` | ✅ `analytics_events`: `misi_selesai` ×3 (10/50/15) + `streak_hari` + `scan_pertama`; `notifications`: 4 baris `mission`, satu terbaca; ledger `mission` ×3 |
| Anti dobel & resubmission | test | ✅ klaim dobel manual/photo → 409; baris rejected dipakai ulang saat unggah ulang (tetap 1 baris) |
| Streak bonus kelipatan | test: 5 hari → touch ke-6 | ✅ bonus 20 lewat ledger `streak` + notif + event `streak_hari`; touch kedua hari sama idempoten |
| Auto_scan filter kategori | test (byte PNG dipetakan deterministik ke kategori mock) | ✅ Organik/Residu tidak menghitung; 2× Plastik → approved |
| CI GitHub | run #12 (`b454c44`) | ✅ sukses — api, admin, mobile, android-apk (4/4 job) |
| Verifikasi browser interaktif & perangkat Android nyata | — | ⚠️ Belum di sesi ini (tool browser & perangkat tidak tersedia — item terbuka sejak Sprint 0); UI ditutup unit/component test + typecheck + build; smoke E2E menutup alur di tingkat API |

---

## 5. Keputusan & Catatan Teknis

1. **Aturan bonus streak adalah keputusan kerja terdokumentasi** (PRD hanya bilang
   "streak harian (reset, bonus)" tanpa angka): bonus **+20 poin tiap kelipatan 6
   hari aktif**, karena teks mockup `beranda.html` — "Streak 5 hari! Jangan putus —
   misi 1 hari lagi untuk bonus +20 poin" — hanya konsisten bila bonus jatuh di
   hari ke-6. Nilainya env (`STREAK_BONUS_POINTS`, `STREAK_BONUS_EVERY_DAYS`; 0 =
   mati) sehingga PO bisa mengubah ke 7-hari-an tanpa deploy. Microcopy UI selalu
   diturunkan dari `days_to_bonus` server sehingga teks dan logika tak mungkin
   pisah.
2. **Aktivitas yang menghitung streak = aksi yang menulis ledger**: scan bernilai
   poin (bukan duplikat), klaim misi manual, dan misi photo yang disetujui.
   Konsekuensi: kalender 7 hari bisa dibangun jujur dari tanggal `point_transactions`
   tanpa tabel baru, dan streak tak bisa "difarming" lewat foto sama berulang
   (poin 0 tidak dihitung). Review menolak tidak menghitung aktivitas.
3. **Streak reset bersifat lazy** (tanpa cron): bolong ≥2 hari → `GET /v1/streak`
   menampilkan 0 (`effective_streak`), dan aktivitas berikutnya memulai dari 1.
   Field `users.current_streak` tetap menyimpan nilai terakhir sampai sentuhan
   berikutnya — sengaja, agar "longest" tetap akurat tanpa job harian.
4. **Bonus streak ikut transaksi aksi pemicu** (bukan job terpisah): bonus
   `source="streak"` ditulis dalam transaksi scan/klaim/approve yang sama — ledger
   append-only tetap satu sumber kebenaran dan tidak ada bonus "hantu" bila request
   gagal. `touch_streak` idempoten per hari (aktivitas kedua tidak menaikkan streak
   maupun bonus).
5. **Poin misi tetap hanya lewat approval** (konsisten keputusan Sprint 4): klaim
   manual = approval saat klaim (`reviewed_at` terisi, `reviewed_by` NULL =
   sistem), approve verifier menulis `points_awarded` + ledger, dan auto_scan
   approve otomatis. Tidak ada jalur poin misi yang melewati ledger.
6. **Auto_scan hanya dihitung dari scan bernilai poin** dan (bila `scan_category_id`
   diisi) dari kategori yang cocok. Baris progres dibuat lazily (`in_progress`) dgn
   SAVEPOINT (`begin_nested`) — dua scan serentak tidak melanggar
   `UNIQUE(user_id, mission_id, period_date)`; yang kalah mengambil ulang baris
   pemenang. Misi `auto_scan` tidak bisa diklaim manual (400 dgn arahan ke Scan).
7. **Notifikasi in-app dipilih sebagai permukaan notif MVP** (push FCM = Sprint 6):
   (a) hasil verifikasi ditandai dibaca saat user membuka daftar misi — chip kartu
   ("Menunggu/Selesai/Perlu diperbaiki") adalah notifikasinya; (b) beranda
   menampilkan "N hasil verifikasi baru" pada kartu menu Misi selama ada unread.
   Tabel `notifications` + `unread_count` sudah mengikuti bentuk PRD §5.9 sehingga
   Sprint 6 tinggal menambah pengiriman FCM; broadcast (`user_id` NULL) sengaja
   belum dilayani endpoint (domain composer Sprint 8).
8. **Level engine disatukan, kontrak diperluas secara aditif**: logika
   `_level_for`/`_highest_level` yang duplikat di `profile.py` & `admin_users.py`
   dipindah ke `services/levels.py` (murni, teruji) dan ditambah kemampuan next-
   level (`next_level/title/min_points`, `points_to_next`, `level_progress_percent`)
   — PRD §5.10 #2 (level tidak disimpan) tetap. `ProfileResponse` bertambah field
   opsional tanpa merusak klien lama.
9. **Catatan wajib saat menolak dipasang di dua lapis**: `reviewError()` di admin
   memblokir + memindahkan fokus ke textarea (AUDIT.md A2), dan server menolak 400
   dgn pesan yang menjelaskan alasannya — klien tidak boleh satu-satunya penjaga.
10. **Hotkey A/R/←→ diabaikan saat fokus di input/textarea/select** (pola mockup)
    supaya verifier bisa menulis catatan "r…" tanpa terpicu aksi; tombol tetap
    tersedia untuk pengguna keyboard-only/screen reader (hotkey hanya akselerator,
    bukan satu-satunya jalan).
11. **Toolchain Android dipin Java 21 + foojay resolver**: lingkungan dev kini hanya
    punya JRE 25 (tanpa `javac`, dan Gradle 8.14 tak bisa jalan di Java 25) — dgn
    `org.gradle.toolchains.foojay-resolver-convention` + toolchain 21, `gradlew`
    mengunduh JDK yang cocok otomatis. CI tidak berubah (setup-java 21 sudah
    sama). `org.gradle.java.home` lokal diset di `~/.gradle` (tidak di-commit).

---

## 6. DoD Sprint 5 — Checklist

- [x] CI hijau di GitHub: run #12 pada `b454c44` **success** (4/4 job) — api (ruff +
      175 pytest + coverage gate 70%), admin (lint + vitest + build), mobile (lint +
      vitest + build), android-apk + artefak APK. Verifikasi lokal: 175 pytest
      (coverage 82,04%), 49+14 vitest, lint bersih, build ketiga app + APK debug.
- [x] Unit/component test logika baru: API 41 test baru (review approve/reject +
      role + idempoten, streak engine/integrasi/bonus, level engine, klaim manual,
      auto_scan + filter kategori, notifikasi), mobile +9 (streak util + kartu
      manual), admin +6 (util verifikasi).
- [x] UI 100% dari `tokens.css` — VerificationView/StreakCard/util nol hardcode
      warna/jarak (nilai non-token hanya angka desain mockup seperti thumbnail
      64px / lingkaran kalender 22px yang tercantum literal di mockup; tanggal &
      angka via Intl id-ID).
- [x] State lengkap: verifikasi admin (skeleton, error+Coba Lagi, antrian kosong,
      disabled saat mengirim), streak beranda (skeleton, data, hilang bila gagal —
      pola widget best-effort), misi (skeleton/empty/error/offline dari Sprint 4
      tetap), notifikasi (best-effort, tidak memblokir layar).
- [x] Aksesibilitas: tap target ≥44px (strip antrian 64px, tombol 48/kbd row),
      `role=listbox/option` + `aria-selected` strip antrian, `role=img` + label
      kalender streak, fokus pindah ke judul panel saat pindah item & ke textarea
      saat tolak tanpa catatan, `kbd-row` `aria-hidden`, ikon `aria-hidden`,
      `prefers-reduced-motion` & `:focus-visible` global dari tokens.css.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata / browser interaktif — **belum di sesi ini**
      (tool browser & perangkat tidak tersedia; item terbuka sejak Sprint 0).
      Pengganti terukur: smoke E2E 23 langkah + unit/component test + APK debug.
      Tinjauan visual menyusul di demo (§7).
- [x] Terdokumentasi: `api/README.md` (endpoint baru + arsitektur
      verifikasi/level/streak/notif), `admin/README.md` (modul Verifikasi),
      `mobile/README.md` (Sprint 5), `.env.example`, laporan ini.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Keputusan PO resmi aturan bonus streak** (±6 hari, +20) | Nilai sekarang = asumsi kerja terdokumentasi §5.1; aman karena env-driven | Review PO — bisa diubah tanpa deploy |
| 2 | Perangkat Android nyata + browser interaktif (terbuka sejak Sprint 0) | Tinjauan visual modul Verifikasi/kartu streak & uji perangkat belum dilakukan | Demo segera setelah tersedia |
| 3 | Hosting staging + `LLM_API_KEY` (terbuka sejak Sprint 0) | Semua angka sprint ini masih mode mock | **Segera** — sebelum demo provider asli |
| 4 | Mutasi pengguna admin (blokir/role/reset poin) | Panel pengguna masih read-only | Usul backlog Sprint 8 (menyusul catatan Sprint 4) |
| 5 | Sisa wiring Google Sign-In native + OAuth Client ID (Sprint 1) | Tidak memblokir Sprint 6 | Fleksibel |

---

## 8. Yang Menyusul (Sprint 6 — Gamifikasi & Home)

Badge engine (kriteria JSONB → evaluasi event — pintu `track_event` untuk
`misi_selesai`/`streak_hari` sudah hidup dan `badges` + kriteria sudah di-seed),
leaderboard MVP (index `users.points` sudah ada), UI profil statistik dampak,
home assembly final (header melengkung + kutipan harian + menu + FAB — kartu
streak Sprint 5 tinggal disisipkan ke susunan final `beranda.html`), FCM setup +
simpan token (`fcm_tokens` siap; notifikasi in-app Sprint 5 menjadi sumber push),
dan konten harian: CRUD + penjadwalan (admin).
