# Laporan Sprint 6 — Gamifikasi & Home

> Periode: 5 September 2026 · Kapasitas: 12 poin · Status: **selesai — 6/6 story diterima
> (12/12 poin)** · Goal sprint: **Beranda lengkap sesuai mockup; badge & leaderboard
> hidup; FCM dasar.**

---

## 1. Ringkasan

Beranda kini utuh 1:1 mockup `beranda.html`: header melengkung menyapa nama asli dengan
blok **Poin Kebaikan** dan avatar; di bawahnya berderet kartu streak (Sprint 5), kartu
dampak **"Pohon Kebaikanmu"** (pohon bertumbuh Bibit → Tunas → Pohon Muda → Pohon Subur →
Pohon Mangga mengikuti total aksi nyata), kartu **"Kutipan Hari Ini"** lengkap dengan
"Aksi hari ini" dan tombol Bagikan, seksi **Misi Hari Ini** (mini misi dengan progres
nyata), dan **Menu Utama** lima kartu — semuanya hidup dari data server, dengan skeleton
per-widget yang hilang bila datanya gagal (pola best-effort beranda).

Gamifikasi berdetak: **badge engine** mengevaluasi kriteria JSONB 10 lencana seed dan
menghadiahkannya otomatis — dipicu on-event di momen poin masuk (scan bernilai poin,
approve verifier, klaim manual) DAN lazy saat tab Pencapaian dibuka, dengan notifikasi
"Lencana baru" per lencana. **Leaderboard MVP** melayani top-N dari index `users.points`
dengan rank kompetisi ketat dan posisi pemohon (`me`) — backend penuh, UI penuh fase 2.
**Konten harian** bisa dijadwalkan admin (modul panel baru `/konten`, satu konten per
hari) dan tayang di beranda; hari tanpa jadwal otomatis menampilkan rotasi bank quote
terkurasi Sprint 2 sehingga kartu wisdom tidak pernah kosong. **FCM dasar** berdiri:
token perangkat tersimpan di `fcm_tokens` (endpoint register/unregister + plugin
`@capacitor/push-notifications` di sisi APK), abstraksi pengirim `PushSender` siap kirim
(mode `log` default; mode `fcm` HTTP v1 menunggu kredensial server — item terbuka), dan
notifikasi in-app Sprint 5 resmi menjadi sumber push.

Bukti cepat (kriteria demo Sprint 6):

| Kriteria demo | Hasil |
|---|---|
| Beranda identik mockup dgn data nyata | ✅ Susunan final: header (Poin Kebaikan + avatar + pill level) → streak → dampak ("Tumbuh menjadi tunas — butuh 2 aksi lagi" dari 3 aksi nyata) → kutipan hari ini (ayat terjadwal dgn aksi) → mini misi ("Scan 3 Jenis Sampah" 1/3) → menu utama → FAB + bottom nav. Smoke E2E 22 langkah menutup data semua widget |
| Badge muncul otomatis setelah aksi | ✅ Scan pertama → lencana "Langkah Kecil" + notifikasi `info` dalam transaksi scan yang sama (on-event); klaim manual → "Misi Pertama" (2/10 diraih); rekor streak 7 hari → lencana muncul lazy saat `GET /v1/badges`; idempoten (muat ulang = tetap 1 baris) |
| CI hijau | ✅ run #14 pada commit fitur — 4/4 job hijau (api, admin, mobile, android-apk) — detail §6 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Badge engine (kriteria JSONB → evaluasi event) | 3 | ✅ | `services/badges.py`: 5 jenis kriteria (`scan_count` = scan bernilai poin, `mission_done` = klaim approved, `streak` = rekor longest, `points_earned` = SUM ledger, `quiz_passed` = kuis lulus — siap utk Sprint 7). `evaluate_criteria()` murni (fail-closed utk kriteria korup), `collect_stats()` satu query per metrik, `sync_user_badges()` idempoten + notifikasi. Dijalankan hybrid: on-event (scan/klaim manual/approve) + lazy (`GET /v1/badges`). Grid lencana tab Pencapaian `misi.html` kini hidup — tanpa perubahan UI sama sekali |
| Leaderboard MVP (index `users.points`) | 1 | ✅ | `GET /v1/leaderboard`: `RANK() OVER (ORDER BY points DESC)` di atas index (PRD §5.10 #7) — poin sama = rank sama; filter aktif & poin > 0; `me` (posisi pemohon, konsisten dgn rank jendela), `total`, level+title dari tangga levels; PII minimal. Backend saja sesuai rencana — UI penuh fase 2 |
| UI profil: statistik dampak, lencana, poin | 3 | ✅ | `GET /v1/profile` +`scans_total`/`missions_approved`/`badges_earned`/`level_progress` (% dari level engine). Layar Profil kini: statistik Poin/Aksi Nyata/Streak, bar "N poin lagi ke <level>", panel **Statistik Dampak** (scan bernilai, misi selesai, lencana), grid 5 lencana (earned/locked) + tautan tab Pencapaian. Kartu dampak `beranda.html` memakai angka yang sama (ImpactCard) |
| Home assembly final (header melengkung, kutipan harian, menu, FAB, bottom nav) | 3 | ✅ | `HomeView` susunan final: header dgn blok Poin Kebaikan + avatar; **ImpactCard** (pohon 5 tahap, pbar ARIA, hitungan "aksi nyata"); **WisdomCard** (label "Kutipan Hari Ini", kutipan font arab, chip tipe, "Aksi hari ini", Bagikan via Web Share API — fallback salin+toast); **mini misi** (maks 2: auto_scan berjalan & bisa diklaim, util murni teruji); **menu utama** 5 kartu (Komunitas toast Fase 2 sesuai mockup, E-Learning "Segera hadir"); FAB + BottomNav. Skeleton per-widget, widget disembunyikan bila API gagal (tidak saling memblokir) |
| FCM setup + simpan token (`fcm_tokens`) | 1 | ✅ | `POST/DELETE /v1/push/token` (upsert idempoten; token akun lain berpindah; token pendek 400). `services/push.py`: protocol `PushSender` → `LogPushSender` (default) & `FcmHttpV1Sender` (kerangka HTTP v1 + validasi kredensial; aktif via `PUSH_MODE=fcm`); `push_notification()` best-effort post-commit di review misi. Mobile: plugin `@capacitor/push-notifications`, izin + registrasi token sekali per sesi (native saja — web dev skip) |
| Konten harian: CRUD + penjadwalan (admin) | 1 | ✅ | `GET/POST/PATCH/DELETE /v1/admin/contents` (admin·editor; hapus admin) + **`ContentsView` (`/konten`)**: form panel (tanggal, tipe ayat/hadis/refleksi, isi wajib, sumber, aksi hari ini, gambar), tabel dgn badge Tayang/Terjadwal. Penjadwalan = `publish_date` UNIQUE (bentrok 409; geser tanggal terdeteksi bentroknya) — tanpa cron. Mobile: `GET /v1/daily-content` → konten hari ini atau fallback bank quote (`fallback: true`) |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Badge engine** (`app/services/badges.py` baru): `BadgeStats` (dataclass statistik),
  `evaluate_criteria()` (murni — kriteria `None`/korup/tidak dikenal/nilai ≤ 0 → tidak
  diraih), `collect_stats()` (scan bernilai poin, klaim approved, rekor streak, SUM
  ledger, kuis lulus dari `user_quiz_attempts`), `sync_user_badges()` (idempoten,
  tanpa commit, +1 notifikasi `type=info` per lencana baru). Dijalankan di:
  `POST /v1/scan` (scan bernilai poin), `_claim_manual`, review approve (semuanya
  dalam transaksi poin), dan `GET /v1/badges` (lazy + commit).
- **Leaderboard** (`app/api/leaderboard.py` baru): `GET /v1/leaderboard?limit=1–100`
  — window `RANK()`, filter `is_active & points>0`, `me` dihitung konsisten
  (1 + jumlah pemilik poin lebih tinggi), level via `resolve_level`.
- **Push** (`app/api/push.py` + `app/services/push.py` baru): endpoint token +
  abstraksi pengirim. `push_notification()` mengambil seluruh token user, kirim paralel
  best-effort (`asyncio.gather(return_exceptions=True)`), broadcast (`user_id` NULL)
  tetap dikembalikan 0 (domain composer Sprint 8). Dijalankan setelah commit di
  `POST /v1/admin/claims/{id}/review` (approve & reject).
- **Konten harian** (`app/api/admin_contents.py`, `app/api/content.py`,
  `app/schemas/content.py` baru): CRUD admin + `GET /v1/daily-content` (fallback
  `daily_fallback_quote()` — rotasi deterministik per tanggal atas bank
  `services/quotes.py`, sumber yang sama dgn scan).
- **Profil**: `ProfileResponse` +`scans_total`, `missions_approved`, `badges_earned`,
  `level_progress` (`level_progress_percent` dari Sprint 5 akhirnya terpakai di
  respons) — dihitung lewat `collect_stats` agar definisi "aksi bernilai" konsisten
  dgn badge engine & streak.
- **Config/env**: `PUSH_MODE` (log|fcm), `FCM_CREDENTIALS_FILE`, `FCM_PROJECT_ID`
  (`.env.example` + README). Tanpa migrasi baru — `fcm_tokens`, `daily_contents`,
  `badges`, `user_badges` sudah ada sejak skema awal (keputusan skema penuh Sprint 0
  terbayar lagi).
- **Test**: 175 → **211** (badge 8, leaderboard 5, push 11, konten 11, +1 test push
  approve di suite verifikasi; total 36 test baru).

### 3.2 Mobile (`mobile/`)

- **`views/HomeView.vue`** ditulis ulang sebagai susunan final (§2 story Home);
  komponen baru `components/home/ImpactCard.vue` & `WisdomCard.vue` (bergabung dgn
  `StreakCard` Sprint 5). Util murni baru: `utils/impact.ts` (5 tahap pohon + hint
  gaya mockup "Tumbuh menjadi … — butuh N aksi lagi", aria pbar), `utils/home.ts`
  (`pickMiniMissions`: auto_scan berjalan dulu diurut persen, lalu misi bisa klaim
  diurut poin), `utils/daily.ts` (label tipe, `wisdomShareText`, `canShare`) —
  27 test vitest baru.
- **`services/push.ts`**: registrasi token FCM (`checkPermissions` →
  `requestPermissions` → `register`, timeout 15 dtk, kirim token + platform ke API;
  sekali per sesi, native saja — di browser di-skip tanpa error). Dependensi baru
  `@capacitor/push-notifications@8.1.2` (plugin resmi, ikut tersinkon ke proyek
  Android).
- **`views/ProfileView.vue`**: statistik dampak (3 angka dgn ikon), bar progres level
  ("N poin lagi ke …", % dari server), grid 5 lencana (earned penuh / locked redup,
  `title` deskripsi) + tautan "Lihat semua lencana" → `/misi`; badge dimuat
  best-effort setelah profil siap.
- **`views/MissionsView.vue`**: hint tab Pencapaian diperbarui — "Lencana diraih
  otomatis dari aksimu — scan, misi, streak, dan poin. Cek notifikasi saat ada
  lencana baru!" (menggantikan "mulai aktif di pembaruan berikutnya").
- **`stores/auth.ts`**: `ProfileData` +field opsional Sprint 6 (kompatibel server lama).

### 3.3 Admin (`admin/`)

- **`views/ContentsView.vue`** (`/konten`): modul Konten Harian (detail §2) — pola
  form panel + tabel responsif `<768px` + badge status; empty state menjelaskan bahwa
  tanpa jadwal aplikasi menampilkan kutipan bank (jujur soal perilaku fallback).
- **AdminShell**: menu "Konten Harian" kini berpindah halaman (sebelumnya toast
  "menyusul"); sisa item nonaktif tidak berubah.

### 3.4 Dokumentasi

- README api (endpoint Sprint 6 + arsitektur gamifikasi/push/konten + env), admin
  (modul Konten Harian), mobile (Sprint 6: beranda final, badge, konten, push) dan
  `.env.example` diperbarui; laporan ini.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 211 lulus, coverage 80,90% (gate 70%) |
| ruff | `ruff check .` + `format --check` | ✅ bersih |
| Vitest | `npm test` mobile & admin | ✅ mobile 66 lulus (8 file — +17 Sprint 6), admin 14 lulus |
| eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses ketiganya |
| APK debug | `cap sync android` + `./gradlew assembleDebug` | ✅ BUILD SUCCESSFUL — `app-debug.apk` 9,9 MB (naik dari 5,7 MB: plugin push); CI juga memproduksinya |
| Smoke E2E Sprint 6 | uvicorn lokal (DB `ekoteologi_smoke`, mock LLM) + klien httpx | ✅ 22 langkah: fallback kutipan → admin jadwalkan konten (409 tanggal ganda, geser tanggal → Tayang) → konten tayang di `daily-content` → scan +5 → lencana "Langkah Kecil" + notif (1/10) → profil dampak (scan=1, badge=1, lvl 10%) → klaim manual +10 → lencana "Misi Pertama" on-event (2/10) → leaderboard rank 1 dgn `me` → register token ×2 idempoten → approve photo +50 → DB: 1 baris `fcm_tokens`, 2 baris `user_badges` → hapus token → streak aktif + notif verifikasi |
| Push terpicu saat approve | test caplog (`test_approve_memicu_push_ke_token_terdaftar`) | ✅ token terdaftar → log `PUSH (mode=log) … 'Misi disetujui!'` saat review approve (pengiriman FCM nyata menunggu kredensial — §5.3) |
| CI GitHub | run #14 (commit fitur) | ✅ sukses — api (ruff + 211 pytest + coverage gate), admin (lint+vitest+build), mobile (lint+vitest+build), android-apk |
| Verifikasi browser interaktif & perangkat Android nyata | — | ⚠️ Belum di sesi ini (tool browser & perangkat tidak tersedia — item terbuka sejak Sprint 0); UI ditutup unit/component test + typecheck + build + APK; smoke E2E menutup alur di tingkat API |

---

## 5. Keputusan & Catatan Teknis

1. **Badge engine hybrid on-event + lazy** (rencana membuka "on-event atau lazy —
   dokumentasikan"): keduanya, karena keduanya murah dan saling menutup. On-event
   (dipanggil di `award_points`-moments: scan bernilai poin, klaim manual, approve
   verifier) memberi notifikasi "Lencana baru" di transaksi yang sama dgn poin —
   konsisten dgn pola streak Sprint 5. Lazy di `GET /v1/badges` menjamin lencana
   tetap terbayar bila poin masuk lewat jalur tanpa event (mis. penyesuaian admin
   di masa depan). Semua penulisan `user_badges` idempoten (PK composite) sehingga
   dobel jalur tidak mungkin menggandakan.
2. **Definisi metrik kriteria konsisten dgn aturan anti-farming lama**: `scan_count`
   hanya menghitung scan bernilai poin (duplikat = 0 poin tidak dihitung — keputusan
   Sprint 2/5), `mission_done` hanya `approved` (satu-satunya status pembawa poin —
   Sprint 4/5), `streak` memakai rekor `longest_streak` (tidak pernah menurun, tidak
   terkena reset lazy), `points_earned` dari SUM ledger (sumber kebenaran — PRD
   §5.10 #1). `quiz_passed` sudah dihitung dari `user_quiz_attempts` meski belum ada
   kuis — Sprint 7 cukup mengisi data, engine tidak disentuh.
3. **Kriteria korup = fail-closed**: kriteria bukan dict, `type` tak dikenal, atau
   `value` bukan angka positif → lencana TIDAK diraih. Lebih aman lencana yang layak
   tidak muncul daripada terberi karena data rusak (admin bisa memperbaiki kriteria;
   lencana menyusul otomatis via jalur lazy).
4. **Sumber "Kutipan Hari Ini" = `daily_contents` (jadwal admin), fallback bank quote
   Sprint 2** — satu sumber kebenaran kutipan. Hari tanpa jadwal menampilkan rotasi
   deterministik per tanggal atas seluruh bank (`daily_fallback_quote`, tanpa
   randomness/state) dgn `fallback: true` dan tanpa "Aksi hari ini" (server tidak
   mengarang aksi). Alternatif (404 + quote dari bank terpisah di klien) menolak:
   menduplikasi bank ke mobile dan memecah sumber kebenaran. Rotasi menghormati PRD §9
   (quote selalu terkurasi, tidak pernah digenerasi).
5. **Penjadwalan konten = `publish_date` UNIQUE, tanpa cron** — pola yang sama dgn
   streak lazy (Sprint 5): "jadwal" adalah tanggalnya, klien mengambil konten hari
   itu. Murah, cukup utk MVP (satu konten/hari memang bentuk tabel PRD §5.6), dan
   admin mendapat 409 yang informatif saat bentrok (dua jalur pengecekan: pre-check +
   tangkap `IntegrityError` untuk race).
6. **Push FCM: infrastruktur selesai, pengiriman nyata item terbuka** (sesuai catatan
   lintas sprint — kredensial tidak tersedia): (a) token tersimpan di `fcm_tokens`
   (upsert idempoten; token yang dipakai akun lain berpindah ke akun baru — perangkat
   sama, ganti akun, pola standar FCM); (b) abstraksi `PushSender` dgn mode `log`
   (default — setiap push tercatat di log, teruji caplog) dan mode `fcm` (kerangka
   FCM HTTP v1: validasi file kredensial + project id; fallback otomatis ke log bila
   konfigurasi kurang — fail-safe); (c) klien Android mendaftarkan token via plugin
   resmi (native saja; web dev skip). Sisa kerja tunggal: pasang JSON service account
   + `PUSH_MODE=fcm` + melengkapi OAuth2 access-token di `_send_one` — Sprint 8
   (composer push) sesuai rencana.
7. **Push best-effort SETELAH commit, bukan bagian transaksi** (kontras dgn notifikasi
   in-app & event yang ikut transaksi): push adalah efek jaringan eksternal — gagal
   push tidak boleh menggagalkan verifikasi yang sudah sah. Notifikasi in-app tetap
   sumber kebenaran; push hanya cerminan (pesan bisa hilang, notif in-app tidak).
8. **Leaderboard = kompetisi ketat dgn `RANK()`**: poin sama mendapat rank sama
   (bukan row-number); urutan tampil dieeterminasi nama agar stabil. `me.rank`
   dihitung dgn rumus yang sama (1 + count poin lebih tinggi) sehingga posisi di
   dalam dan di luar jendela top-N tidak pernah kontradiktif. Poin nol/nonaktif
   tidak dipajang — papan hanya menampilkan peserta nyata; PII dibatasi nama/kota/
   avatar (PRD §9).
9. **Tahap pohon dihitung di klien dari angka server** (pola streak: server angka,
   klien mikrokonteks): `GET /v1/profile` mengirim `scans_total`+`missions_approved`
   (definisi identik dgn badge engine — satu fungsi `collect_stats`), klien
   (`utils/impact.ts` murni, teruji) menurunkan tahap Bibit→Mangga, persen, dan teks
   "Tumbuh menjadi … — butuh N aksi lagi" gaya mockup. Ambang (5/15/30/50) adalah
   asumsi kerja terdokumentasi — bisa dipindah ke server/env saat PO menetapkan.
10. **Beranda widget best-effort dgn skeleton sendiri-sendiri** (pola Sprint 5):
    streak/dampak/wisdom/mini misi masing-masing independen — kegagalan satu widget
    menyembunyikannya, bukan merobohkan beranda; offline tetap ditangani OfflineBar
    global. Ini konsekuensi keputusan arsitektur beranda "banyak sumber kecil"
    (7 endpoint ringan yang seluruhnya sudah ada) alih-alih satu endpoint agregat
    `/v1/home` — tanpa N+1 berarti di sisi klien (7 request paralel kecil), dan
    endpoint agregat bisa ditambah nanti tanpa mengubah widget.
11. **`GET /v1/badges` kini menulis (lazy sync + commit)** — endpoint baca yang juga
    mengisi: disengaja, idempoten, dan dibayar oleh DoD "lencana otomatis". Risiko
    samping minim (paling banyak 10 lencana, evaluasi ~4 query per user per akses);
    jika beban jadi masalah, jalankan hanya on-event dan jadikan lazy opsional.
12. **Menu E-Learning & Komunitas sengaja tetap "Segera hadir"/toast Fase 2** — persis
    mockup; E-Learning menyusul Sprint 7 sesuai rencana.

---

## 6. DoD Sprint 6 — Checklist

- [x] CI hijau di GitHub: run #14 pada commit fitur **success** (4/4 job) — api (ruff +
      211 pytest + coverage gate 70%), admin (lint + vitest + build), mobile (lint +
      vitest + build), android-apk + artefak APK. Verifikasi lokal: 211 pytest
      (coverage 80,90%), 66+14 vitest, lint bersih, build ketiga app + APK debug.
- [x] Unit/component test logika baru: API 36 test (badge engine murni + integrasi
      on-event/lazy + idempoten, leaderboard rank/me/filter, push token + abstraksi
      + pipe notifikasi, konten CRUD/jadwal/fallback), mobile +17 vitest (tahap
      pohon, mini misi, label/share konten), admin (logika UI Konten mengikuti pola
      panel — perubahan tampilan murni, ditutup typecheck+build).
- [x] UI 100% dari `tokens.css` — HomeView/ImpactCard/WisdomCard/ProfileView/
      ContentsView nol hardcode warna/jarak (nilai non-token hanya angka desain
      mockup seperti tree-visual 64px / badge-medal 48px / label 10px yang tercantum
      literal di mockup; angka & tanggal via Intl id-ID).
- [x] State lengkap: beranda (skeleton per-widget, widget hilang bila gagal, offline
      global), tab Pencapaian & lencana profil (skeleton/empty/error tetap), konten
      admin (skeleton, empty, error+Coba Lagi, 409 informatif), leaderboard (API
      lengkap — UI fase 2).
- [x] Aksesibilitas: tap target ≥44px (share-btn 44, see-all 44, menu-card ≥108,
      tombol 48), pbar dampak/level/mini misi `role=progressbar` + aria, grid lencana
      terlock tetap terbaca (kontras token), ikon `aria-hidden`, chip tipe kutipan
      berlabel, `prefers-reduced-motion` & `:focus-visible` global dari tokens.css.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata / browser interaktif — **belum di sesi ini**
      (tool browser & perangkat tidak tersedia; item terbuka sejak Sprint 0).
      Pengganti terukur: smoke E2E 22 langkah + unit/component test + APK debug
      (registrasi token push hanya aktif di build native — perangkat menunggu).
- [x] Terdokumentasi: `api/README.md` (endpoint + arsitektur gamifikasi/push/konten +
      env), `admin/README.md` (modul Konten Harian), `mobile/README.md` (Sprint 6),
      `.env.example`, laporan ini.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Kredensial FCM server** (akun GCP + service account — plan §2.2, terbuka sejak Sprint 0) | Push terkirim hanya di log (`PUSH_MODE=log`); mode `fcm` siap tapi `_send_one` perlu OAuth2 access-token + kredensial asli. Registrasi token di sisi APK sudah jalan | Sprint 8 (composer push) — atau segera bila kredensial terbit |
| 2 | Perangkat Android nyata + browser interaktif (terbuka sejak Sprint 0) | Tinjauan visual beranda final/kartu dampak & uji registrasi token FCM di WebView/APK belum dilakukan | Demo segera setelah tersedia (APK siap: `adb install`) |
| 3 | Hosting staging + `LLM_API_KEY` (terbuka sejak Sprint 0) | Semua angka sprint ini masih mode mock | **Segera** — sebelum demo provider asli |
| 4 | Ambang tahap pohon (5/15/30/50 aksi) & aturan bonus streak — ratifikasi PO | Nilai sekarang = asumsi kerja terdokumentasi §5.9 (dan Sprint 5 §5.1) | Review PO — bisa diubah tanpa deploy |
| 5 | Sisa wiring Google Sign-In native + OAuth Client ID (Sprint 1) | Tidak memblokir Sprint 7 | Fleksibel |

---

## 8. Yang Menyusul (Sprint 7 — E-Learning & Konten Harian)

Admin CRUD modul + editor blok lesson (JSONB) + bank soal; mobile list/detail modul +
pelajaran (blok konten `elearning.html`); kuis (pengerjaan, penilaian otomatis, poin
jika lulus); progress tracking (`user_module_progress`); konten harian sisi mobile
(wisdom card + refleksi — infrastruktur Sprint 6 tinggal dipakai); polish onboarding.
Kontrak yang sudah siap: `modul_selesai` tinggal lewat `track_event()`, kriteria
lencana `quiz_passed` sudah dievaluasi badge engine (lencana "Cendekiawan Hijau"
terbuka otomatis begitu kuis ada), dan event `misi_selesai` misi berbasis pelajaran
bisa mengikuti pola klaim manual.
