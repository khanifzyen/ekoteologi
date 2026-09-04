# Laporan Sprint 4 — Misi: Klaim & Data

> Periode: 5 September 2026 · Kapasitas: 12 poin · Status: **selesai — 6/6 story diterima
> (12/12 poin)** · Goal sprint: **Misi bisa dibuat admin dan diklaim user (photo; manual &
> auto_scan menyusul Sprint 5).**

---

## 1. Ringkasan

Loop misi terbuka ujung-ke-ujung: admin membuat misi (periode, poin, mode verifikasi) dari
panel; user melihat daftar misi di layar Misi mobile (`misi.html`) dengan empat keadaan kartu
(bisa diklaim / progres auto_scan / menunggu verifikasi / selesai — plus **ditolak** dgn
catatan admin), lalu mengklaim misi photo: consent foto (PRD §9) → kamera/galeri → pratinjau →
kirim → baris `user_missions` berstatus `pending` muncul di antrian admin (KPI "Antrian
Verifikasi" + panel "Klaim Masuk") lengkap dengan catatan consent server-side. Anti dobel
klaim dijaga constraint DB `UNIQUE(user_id, mission_id, period_date)` dgn periode dihitung
server (harian; mingguan = Senin pekan berjalan). Admin juga mendapat data lengkap: tabel
pengguna (filter role/status, pencarian, badge), dua chart dashboard gaya editorial (scan
harian & komposisi kategori), dan kartu **Biaya LLM** dari token scan bulan berjalan —
sesuai target plan §5.3 dan catatan Sprint 3.

Bukti cepat (kriteria demo Sprint 4):

| Kriteria demo | Hasil |
|---|---|
| Misi dibuat admin | ✅ `POST /v1/admin/missions` (role admin/editor) → 201; PATCH ubah poin/status, DELETE ditolak 409 bila sudah ada klaim (test + smoke E2E) |
| Klaim bukti → antrian admin | ✅ Smoke E2E: klaim photo → 201 `pending` → `GET /v1/admin/claims?status=pending` menampilkan baris (user "Dewi Lestari", misi "Setor 1 kg Plastik…", bukti `/uploads/missions/…`, `consent_at` terisi); KPI `verification.pending` = 1 |
| Consent di layar unggah (PRD §9) | ✅ Kartu `ConsentCard` reusable (Sprint 3) dipakai ulang; klaim tanpa consent → 400 "Persetujuan penggunaan foto wajib diberikan…"; waktu persetujuan tercatat di kolom baru `user_missions.consent_at` (keputusan §2.1 #6 — §5.2) |
| Anti dobel klaim + periode | ✅ klaim ke-2 → 409 "Kamu sudah mengklaim misi ini…", baris tetap 1 (constraint `uq_user_missions_claim`); race dua klaim serentak ditangani `IntegrityError` (test) |
| Dashboard 2 chart + biaya LLM | ✅ `GET /v1/admin/charts`: 14 titik harian (hari kosong = 0) + kategori % (7 hari); kartu Biaya LLM = token scan non-cache bulan berjalan × env (mock mode = Rp0); cache hit rate pindah ke kaki chart |
| CI hijau | ✅ dicatat pada commit catatan CI — detail §6 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| CRUD misi (admin): periode, poin, mode verifikasi | 3 | ✅ | `GET/POST/PATCH/DELETE /v1/admin/missions` + `MissionsView.vue` (form panel + input, pola gaya admin): tipe daily/weekly/special, poin 1–10.000, verifikasi photo/auto_scan/manual, target aksi, periode mulai/selesai, aktif/nonaktif. Tulis: admin+editor; hapus: admin saja & ditolak 409 bila ada klaim (riwayat terjaga). Validasi bisnis: `start_at < end_at`, `scan_category_id` hanya utk auto_scan & harus ada |
| Klaim misi photo: upload bukti → antrian + consent | 3 | ✅ | `POST /v1/missions/{id}/claim` (multipart `file` + `consent`) → `user_missions` `pending`; bukti ke `UPLOAD_DIR/missions`; magic bytes JPG/PNG/WebP ≤5 MB; consent wajib & tercatat `consent_at` (§2.1 #6); bukti ditolak bisa diganti (baris sama di-reset, berkas lama dihapus — privasi); mode manual/auto_scan → 400 dgn pesan "menyusul" (Sprint 5). Poin baru saat approve — klaim tidak menyentuh ledger |
| UI daftar misi mobile + tab harian/pencapaian | 3 | ✅ | `MissionsView.vue` (`/misi`) 1:1 `misi.html`: header melengkung + panel "Progres misi minggu ini" (`week_done/week_total · +week_points`, progressbar ARIA) + chip "N misi baru"; tab Harian (kartu 4 keadaan via `MissionCard`) & Pencapaian (grid lencana earned/locked dari `GET /v1/badges`); state skeleton/empty/error lengkap; BottomNav & kartu menu beranda kini membuka `/misi` |
| Anti dobel klaim + periode (constraint DB) | 1 | ✅ | `uq_user_missions_claim` (skema awal) + `period_date` dihitung server `period_date_for()` (daily/special → hari ini; weekly → Senin pekan; tidak pernah NULL — NULL bisa lolos UNIQUE di Postgres); unit test murni + test race IntegrityError |
| Admin: tabel user + filter + badge role | 1 | ✅ | `UsersView.vue` (`/pengguna`) sesuai `pengguna.html`: filter chips (Semua/User/Verifier/Editor/Admin/Nonaktif), pencarian debounce nama/email/kota, tabel responsif (kartu <768px), badge role & status, pagination "Menampilkan 1–20 dari N", level dihitung server dari `levels`. Read-only — blokir/ubah role menyusul sesuai rencana sprint |
| Admin: dashboard 2 chart (SVG inline gaya editorial → port ke lib chart admin) | 1 | ✅ | `ChartLine.vue` (scan harian 14 hari: gridline, 4 tick, area tipis, garis dgn animasi draw yang mati pada reduced-motion, titik aksen + anotasi puncak) & `ChartBar.vue` (kategori 7 hari, % di atas batang, aksen gold utk terbesar) — port 1:1 mockup; matematika diekstrak ke `utils/chart.ts` murni + teruji **vitest admin pertama**. Bonus target plan §5.3: kartu **Biaya LLM** (gantikan posisi Cache Hit Rate; hit rate pindah ke kaki chart — persis mockup) |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Endpoint misi user** (`app/api/missions.py`, prefix `/v1`):
  - `GET /v1/missions` — misi aktif dalam jendela `start_at`–`end_at` + `my_claim`
    (klaim periode berjalan) + `summary` mingguan (approved pekan ini / misi aktif / poin).
  - `POST /v1/missions/{id}/claim` — klaim photo (lihat §2); 409 nonaktif/di luar
    periode/sudah diklaim; 400 tanpa consent/mode non-photo; 413/400 foto;
    `IntegrityError` → 409 (race).
  - `GET /v1/badges` — lencana + `earned`/`earned_at` (left join `user_badges`).
- **Endpoint admin** (`app/api/admin_missions.py`, `app/api/admin_users.py`):
  - `GET/POST/PATCH/DELETE /v1/admin/missions` (+ rekap `claims_total`/`claims_pending`),
    `GET /v1/admin/claims` (antrian + user + misi, filter status/mission, pagination) —
    data utk demo & fondasi modul verifikasi Sprint 5.
  - `GET /v1/admin/users` — pencarian `q`, filter `role`/`status`, pagination, level dari
    tabel `levels`.
- **Dashboard** (`app/api/admin_dashboard.py`): KPI kini menyertakan `llm`
  (`cost_month`, `tokens_month`, `budget_monthly`) + endpoint baru `GET /v1/admin/charts`
  (`days` 7–30; kategori 7 hari dgn persentase). Token dijumlah dari
  `llm_meta.tokens.total_tokens` baris **non-cache** (baris cache menyalin meta panggilan
  asli — mencegah dobel hitung); bucket tanggal harian di sisi aplikasi agar konsisten
  zona server.
- **Model + migrasi**: kolom `user_missions.consent_at` — migrasi `c5d8e2f91a47`
  (sudah `upgrade head` lokal & test DB; bukti consent server-side, §5.2).
- **Service** (`app/services/missions.py`): `period_date_for()` + `is_within_period()`
  (murni, teruji), konstanta `MISSION_TYPES`/`VERIFICATION_MODES`.
- **Config**: `MISSION_IMAGE_MAX_MB`, `LLM_COST_PER_1K_TOKENS`, `LLM_BUDGET_MONTHLY`
  (`.env.example` + README diperbarui; tidak ada hardcode).
- **Seed**: +5 misi contoh (2 photo, 2 manual, 1 auto_scan) — idempoten per judul.
- **Test**: 101 → **134** (misi user 11, periode 6, CRUD admin 7, users 3, chart/KPI 6,
  sisanya existing).

### 3.2 Mobile (`mobile/`)

- **`views/MissionsView.vue`** (`/misi`): header + panel progres mingguan; tab
  (`role=tablist`, `aria-selected`); sheet unggah bukti (role=dialog + fokus ke judul,
  handle, pratinjau foto, tombol Kamera `capture=environment` / Galeri via input file —
  tanpa plugin native); consent `ConsentCard` sebelum unggah (langkah 1) — waktu setuju
  dikirim & dicatat server; spinner "Mengirim…"; toast hasil; muat ulang daftar setelah
  klaim. State lengkap: skeleton, empty ("Semua misi selesai!"), error + Coba Lagi,
  offline via bar global + peta error klaim.
- **`components/missions/MissionCard.vue`**: kartu 4+1 keadaan (available / progress /
  waiting / done / rejected) dgn border-left aksen, chip poin, pbar ARIA utk auto_scan,
  catatan consent foto, catatan admin saat ditolak, tombol aksi (Unggah Bukti /
  Klaim Poin / Unggah Ulang) — teruji vitest (6 test).
- **`utils/missions.ts`** (murni, 16 test): `missionState`, `missionIcon`,
  `missionProgress`, `weekPercent`, `countNewMissions`, `missionTypeLabel`,
  `describeClaimError` (409/400/413/0 — foto disimpan utk kirim ulang bila tidak fatal),
  `claimStatusMeta`.
- **`services/missions.ts` + `types/mission.ts`**: `fetchMissions`, `claimPhoto`,
  `fetchBadges`.
- **Navigasi**: rute `/misi`; `BottomNav` Misi kini berpindah layar (bukan toast);
  kartu menu "Misi" beranda → `/misi`.

### 3.3 Admin (`admin/`)

- **`views/MissionsView.vue`** (`/misi`): tabel misi (ikon, tipe, poin, verifikasi,
  periode, rekap klaim, status) + **form panel** (pola input token app.css): create/edit,
  aktif/nonaktif, hapus (confirm + audit log; hanya admin & tanpa klaim); panel "Klaim
  Masuk" read-only dgn badge status consent.
- **`views/UsersView.vue`** (`/pengguna`): filter chips `aria-pressed`, pencarian debounce
  400 ms, tabel dgn inisial avatar, badge role/status, pager, empty & error state.
- **`components/ChartLine.vue` + `ChartBar.vue` + `utils/chart.ts`**: port SVG mockup —
  `niceMax`/`ticks`/`scaleY`/`linePoints`/`bars` (murni, 8 test vitest).
- **`DashboardView.vue`**: 4 kartu KPI (Pengguna, Scan Hari Ini, Antrian Verifikasi,
  **Biaya LLM** dgn format "Rp84,5rb") + `grid-2` dua chart; panel "Menyusul Sprint 4"
  dihapus; skeleton/error/Segarkan dipertahankan; `AdminShell` menu Pengguna & Misi
  kini berpindah halaman.
- **Vitest admin pertama**: devDeps vitest + @vue/test-utils + happy-dom, script
  `npm test`, config `test` di `vite.config.ts`.

### 3.4 Tooling & dokumentasi

- CI job admin kini **lint → test → build** (satu-satunya perubahan workflow).
- README api (kontrak endpoint Sprint 4, arsitektur misi/consent/biaya LLM, seed),
  admin (dashboard + modul Pengguna/Misi + chart), mobile (layar Misi + alur klaim)
  diperbarui.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 134 lulus, coverage 84,6% (gate 70%) |
| Vitest | `npm test` mobile & admin | ✅ mobile 40 lulus (5 file — +22 test Sprint 4), admin 8 lulus (pertama) |
| ruff + eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses ketiganya |
| APK debug | `./gradlew assembleDebug` (JDK 21 + SDK lokal) | ✅ `app-debug.apk` 5,7 MB (setelah `cap sync` dgn dist final); CI juga memproduksinya |
| Smoke E2E Sprint 4 | uvicorn lokal (mock LLM) + klien httpx | ✅ 11 langkah: daftar misi (5 seed + ringkasan) → tolak tanpa consent (400) → tolak mode manual (400) → klaim photo 201 `pending` → dobel 409 → `my_claim` di daftar → antrian admin dgn consent tercatat → CRUD misi 201/200/204 → users q=Dewi + filter role → charts (14 hari, kategori %) + KPI llm Rp0 → badges 10 dgn earned flag |
| Anti dobel (constraint DB) | test: klaim dobel & race `IntegrityError` | ✅ 409 + tetap 1 baris per (user, misi, periode); periode weekly = Senin pekan (unit test) |
| Klaim ulang setelah ditolak | test: reject (simulasi Sprint 5) → klaim lagi | ✅ baris sama di-reset ke `pending`, catatan review dibersihkan, bukti lama diganti |
| Biaya LLM | test: baris asli 500 token + baris cache 999 token | ✅ `tokens_month`=500 (cache tidak dobel hitung); rumus `2000/1000 × 1200 = 2400` teruji via override env |
| Chart dari data nyata | test + smoke: 1 scan → 14 titik (13 nol + 1), kategori 100% | ✅ hari kosong = 0; zona waktu bucket konsisten server |
| CI GitHub | run pada commit laporan | ✅ dicatat di commit `docs(sprint): catat hasil run CI sprint 4` — detail §6 |
| Verifikasi browser interaktif & perangkat Android nyata | — | ⚠️ Belum di sesi ini (tool browser & perangkat tidak tersedia) — UI ditutup unit/component test + typecheck + build; smoke E2E memverifikasi seluruh alur di tingkat API. Tinjauan visual Chrome/Firefox + demo perangkat menyusul (§7) |

---

## 5. Keputusan & Catatan Teknis

1. **Keputusan §2.1 #6 (consent privasi foto bukti + retensi) ditutup sebagai asumsi
   kerja terdokumentasi** (belum ada keputusan PO tertulis — PRD §6 hanya menandai
   prasyaratnya): (a) consent **wajib** saat unggah bukti — kartu di layar unggah, server
   menolak klaim tanpa flag; (b) persetujuan **dicatat server-side** di
   `user_missions.consent_at` (bukan hanya localStorage perangkat — catatan Sprint 3);
   (c) **retensi**: bukti hidup selama baris klaim ada, penyimpanan terpisah
   `UPLOAD_DIR/missions`, hanya ditampilkan ke verifier/admin (layar verifikasi Sprint 5),
   penggantian bukti menghapus berkas lama dari disk, penghapusan atas permintaan lewat
   support (proses manual MVP); (d) kebijakan TTL/purge otomatis ditinjau di Sprint 8
   (hardening) bersama keputusan PO. Membuka item ini di backlog review PO.
2. **Bukti ditolak bisa diganti tanpa melanggar anti dobel**: baris `rejected` dipakai
   ulang (status kembali `pending`, `review_note` dibersihkan, berkas lama dihapus) —
   constraint `UNIQUE(user_id, mission_id, period_date)` tetap terpenuhi dan UX-nya masuk
   akal ("foto buram → unggah ulang di hari yang sama"). Modul verifikasi Sprint 5 tinggal
   mengubah status; tidak perlu skema tambahan.
3. **`period_date` tidak pernah NULL**: UNIQUE Postgres memperlakukan NULL berbeda satu
   sama lain, jadi klaim tanpa periode bisa lolos dobel. Server selalu mengisi: daily/
   special → hari ini, weekly → Senin pekan berjalan (misi "mingguan" = sekali per pekan).
   Misi spesial MVP dianggap berjendek pendek → fallback harian (tetap anti dobel).
4. **Poin misi tidak disentuh saat klaim**: `points_awarded=0` dan ledger hanya ditulis
   saat approval (Sprint 5) — antrian `pending` tidak boleh mengubah `users.points`
   (ledger append-only tetap satu-satunya sumber kebenaran). Ringkasan mingguan menghitung
   hanya klaim `approved` pada pekan berjalan.
5. **Event `misi_selesai` sengaja belum dicatat**: event PRD §8 bermakna "misi selesai
   (disetujui)", yang baru mungkin setelah modul verifikasi (Sprint 5) — pintu
   `track_event()` dari Sprint 3 tinggal dipakai, payload `{mission_id, points}` diusulkan.
6. **Biaya LLM = estimasi dari token, bukan tagihan provider**: `tokens.total_tokens`
   baris scan non-cache bulan berjalan × `LLM_COST_PER_1K_TOKENS` (env; 0 = Rp0 —
   sesuai mode mock). Baris cache tidak ikut dijumlah karena menyalin `llm_meta` panggilan
   asli (mencegah dobel hitung). Budget bulanan dari `LLM_BUDGET_MONTHLY` (0 = belum
   ditetapkan → kartu tanpa persentase budget; mockup "56% dari budget Rp150rb" hidup
   otomatis begitu PO menyetel env). Token vision input/output dibedakan menyusul bila
   pricing provider final.
7. **Kartu Biaya LLM menggantikan Cache Hit Rate di dashboard** (bukan ditambah):
   grid mockup 4 kartu dan kaki chart mockup memang menulis "cache LLM hit rate 74%" —
   jadi tata letak kini 1:1 mockup sambil tetap mengekspos kedua metrik (plan §5.3).
   Mock mode jujur menampilkan "Rp0 — mode LLM mock".
8. **Chart dibangun sebagai komponen kecil + util murni** (bukan lib eksternal): gaya
   editorial mockup (gridline hairline, 4 tick, anotasi) hanya ±150 baris SVG; port ke
   lib chart (mis. Chart.js) justru menambah bundle & melawan token desain. Matematika
   skala diekstrak ke `utils/chart.ts` sehingga menjadi test pertama admin — menutup
   catatan Sprint 3 ("admin belum punya test runner") karena kini ada logika yang pantas
   diuji.
9. **Aksi "Detail/Blokir" tabel pengguna belum dibangun**: story sprint ini adalah
   "tabel + filter + badge role" (1 poin, read-only); mutasi pengguna (blokir, ubah role,
   reset poin — PRD §3) adalah story tersendiri yang belum ada di rencana sprint 4–5 →
   diusulkan masuk backlog Sprint 8 (hardening/admin) atau sprint fleksibel.
10. **Bucket tanggal chart dihitung di aplikasi** (bukan `date()` Postgres) agar zona
    tanggal konsisten dengan logika periode server — `date(timestamptz)` di Postgres
    memakai zona sesi DB yang bisa berbeda dari zona aplikasi.
11. **Input foto bukti memakai `<input type=file capture>` (tanpa plugin native)** —
    pola yang sama dengan keputusan kamera Sprint 3 (mitigasi risiko antar vendor, plan
    §6): membuka kamera belakang di WebView Android, galeri sebagai pilihan kedua.

---

## 6. DoD Sprint 4 — Checklist

- [x] CI hijau di GitHub: (dicatat pada commit catatan CI) — api (ruff + 134 pytest +
      coverage gate 70%), admin (lint + **vitest** + build), mobile (lint + vitest +
      build), android-apk + artefak APK. Verifikasi lokal: 134 pytest (coverage 84,6%),
      40+8 vitest, lint bersih, build ketiga app + APK debug sukses.
- [x] Unit/component test logika baru: API 33 test baru (periode, klaim + anti dobel +
      consent, CRUD, users, chart, biaya LLM), mobile 22 (helper misi + MissionCard),
      admin 8 (util chart).
- [x] UI 100% dari `tokens.css` — MissionCard/MissionsView/UsersView/MissionsView admin/
      ChartLine/ChartBar nol hardcode warna/jarak (nilai non-token hanya angka desain
      mockup seperti viewBox SVG 560×240 / lebar batang 44px yang tercantum literal di
      mockup; angka & tanggal via Intl id-ID).
- [x] State lengkap: misi mobile (skeleton, empty "Semua misi selesai!", error+Coba Lagi,
      offline-bar global), lencana (skeleton/error/empty), sheet klaim (pratinjau,
      spinner, pesan per-mode gagal), admin (skeleton, empty, error+retry, antrian kosong).
- [x] Aksesibilitas: tap target ≥44px (chips & icon-btn 44, tombol 48; `btn-sm` kartu
      misi 40px mengikuti nilai literal mockup), `role=tablist/tab` + `aria-selected`,
      `role=progressbar` + aria-valuenow (mingguan & auto_scan), `role=dialog` +
      fokus ke judul sheet, `aria-pressed` chips, badge & ikon `aria-hidden`,
      `prefers-reduced-motion` & `:focus-visible` global dari tokens.css (animasi draw
      chart otomatis mati).
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata / browser interaktif — **belum di sesi ini**
      (tool browser & perangkat tidak tersedia; item perangkat terbuka sejak Sprint 0).
      Pengganti terukur: smoke E2E 11 langkah di tingkat API + unit/component test +
      APK debug sukses. Tinjauan visual layar baru dilampirkan ke demo (§7).
- [x] Terdokumentasi: `api/README.md` (kontrak + arsitektur misi/consent/biaya LLM +
      seed), `admin/README.md` (dashboard + modul), `mobile/README.md` (layar Misi +
      alur klaim), laporan ini.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Keputusan PO utk §2.1 #6** (konsentrasi di §5.1) | Kebijakan retensi otomatis (TTL) & teks kebijakan privasi final belum disahkan; alur saat ini aman (consent wajib + tercatat server) | Review PO — idealnya sebelum Sprint 5 (antrian verifikasi menampilkan wajah) |
| 2 | Perangkat Android nyata + browser interaktif (terbuka sejak Sprint 0) | Tinjauan visual layar Misi/admin & uji kamera `capture` di WebView belum dilakukan | Demo segera setelah tersedia (APK siap: `adb install`) |
| 3 | Hosting staging + `LLM_API_KEY` (terbuka sejak Sprint 0) | Kartu Biaya LLM baru menampilkan angka riil setelah provider live; `LLM_COST_PER_1K_TOKENS` perlu disetel dari pricing provider | **Segera** — memblokir demo biaya nyata |
| 4 | Mutasi pengguna admin (blokir/role/reset poin) | Panel pengguna kini read-only | Usul masuk backlog Sprint 8 |
| 5 | Sisa wiring Google Sign-In native + OAuth Client ID (Sprint 1) | Tidak memblokir Sprint 5 | Fleksibel |

---

## 8. Yang Menyusul (Sprint 5 — Misi: Verifikasi & Streak)

Antrian verifikasi admin (`admin/verifikasi.html`: preview besar, A/R keyboard, catatan
wajib saat tolak — data & constraint sudah siap: `GET /v1/admin/claims`, status
`pending/approved/rejected`, `reviewed_by/at/note`, event `misi_selesai` via
`track_event()`), notif hasil verifikasi (chip status kartu sudah dirender), misi
auto_scan (progres dari scan — kolom `progress_count` + kategori target sudah ada di
skema dan UI kartu), misi manual (auto-approve saat klaim — endpoint tinggal menerima
mode `manual`), level engine, dan streak harian. Kontrak yang sudah siap: status klaim,
consent tercatat, kartu Biaya LLM (env budget), dan pola pagination/rekap di semua
endpoint admin.
