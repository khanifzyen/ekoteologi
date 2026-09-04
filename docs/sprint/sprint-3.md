# Laporan Sprint 3 — Scan AI: Mobile

> Periode: 5 September 2026 · Kapasitas: 12 poin · Status: **selesai — 5 story diterima (11 poin),
> 1 story (uji lapangan di perangkat) diselesaikan dengan pengganti terukur — alasan terdokumentasi**
> Goal sprint: **Scan pertama selesai di perangkat — fitur signature jalan penuh.**

---

## 1. Ringkasan

Fitur signature kini jalan penuh dari sisi pengguna: beranda → FAB kamera → consent foto
(PRD §9) → izin kamera → preview langsung dengan overlay frame (garis sudut + grid + sweep
ambient) → shutter + flash → `POST /v1/scan` → sheet hasil slide-up dengan stagger (nama
item, tag kategori berwarna, chip `+N POIN`, saran pembuangan, kutipan dari bank terkurasi
server) → poin masuk ke ledger dan total poin tersinkron di UI. Kuota harian server
(`SCAN_DAILY_LIMIT`) ditangani utuh di UI: pill "sisa scan hari ini", penanganan 429 +
`Retry-After`, dan sheet error berbeda untuk tiap mode gagal (429/502/413/400/luring).
Riwayat scan dengan filter kategori menghidupkan menu "Riwayat" `beranda.html`, dan gate
metrik aktivasi PRD §8 mulai berdetak: event `scan_pertama` tercatat di tabel
`analytics_events` tepat pada scan pertama tiap user. Dashboard admin mendapat KPI cards
read-only dari data nyata. Kamera memakai API WebView standar (`getUserMedia`) + fallback
galeri — tanpa plugin native baru — sesuai mitigasi risiko antar vendor (plan §6).

Bukti cepat (kriteria demo Sprint 3):

| Kriteria demo | Hasil |
|---|---|
| Scan pertama selesai | ✅ E2E nyata: register → login → `POST /v1/scan` 200 → sheet hasil (item "Kulit pisang", Organik, +5 poin, `cached=false`) → profil poin 5; event `scan_pertama` tercatat di DB (payload `{scan_id, category, points}`) dan log `EVENT scan_pertama user=… scan=…` |
| Foto sama → cache + anti duplikat | ✅ scan ke-2 foto sama: `cached=true duplicate=true points=0` dalam 10 ms (vs 38 ms MISS+mock LLM); UI menampilkan chip "POIN 0" + catatan "Foto sama dengan scan hari ini — poin tidak bertambah." |
| Kuota harian ditangani UI | ✅ `GET /v1/scans/quota` → pill "Sisa scan hari ini: 18 dari 20"; 429 (limit 2) → 429 + `Retry-After` (test) → sheet "Kuota Scan Habis" dengan estimasi reset; "Coba Lagi" pada 429 kembali ke kamera tanpa unggah sia-sia |
| Riwayat + filter kategori | ✅ `GET /v1/scans` terbaru dulu (total=2, milik user sendiri saja), `?category_id=1` terfilter, `limit/offset` pagination; UI chips Semua + 7 kategori seed, dikelompokkan Hari ini/Kemarin |
| CI hijau | ✅ run #8 pada `203d969` — 4/4 job hijau (api, admin, mobile **termasuk vitest**, android-apk) — detail §6 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| UI scan: camera-preview + overlay frame + sheet hasil (stagger, flash, permission, error) | 5 | ✅ | `ScanView.vue` 1:1 mockup `scan.html`: frame sudut emas + grid + sweep 2.2s (idle saja), status pill `aria-live` 4 keadaan, shutter 72px + flash 180ms, sheet slide-up 320ms `ease-spring` + stagger 6 anak, permission card + error card. Preview kamera `getUserMedia` (kamera belakang) — detail keputusan §5.1 |
| Riwayat scan + filter kategori | 1 | ✅ | `HistoryView.vue` (`/riwayat`) + endpoint baru `GET /v1/scans` (`category_id`, `limit`≤50, `offset`), `/categories`, `/quota`. Chips 44px `aria-pressed`, grup Hari ini/Kemarin/tanggal, "Muat lagi (N tersisa)", state skeleton/empty/error lengkap |
| Integrasi poin scan → ledger + batas harian | 3 | ✅ | Poin ditulis server via ledger Sprint 2; klien menyinkronkan `points_total` ke auth store (`applyPoints`); chip "+N POIN"/"POIN 0"; pill kuota + 429/`Retry-After` ditangani UI; `ApiError` kini membawa `retryAfterSeconds` |
| Consent + storage foto (privasi PRD §9) | 1 | ✅ | `ConsentCard.vue` reusable (dipakai scan; siap dipakai bukti misi Sprint 4) — wajib disetujui sebelum unggah pertama; status di localStorage (`utils/consent.ts`, teruji). Foto tersimpan server di `UPLOAD_DIR/scans` (dilayani `/uploads`). Pencatatan consent server-side menyusul Sprint 4 (keputusan §2.1 #6) |
| Uji lapangan scan di perangkat (latency, kualitas foto) | 1 | 🟡 Pengganti | Tidak ada perangkat Android fisik di lingkungan ini (terbuka sejak Sprint 0). Yang dikerjakan: (1) instrumentasi latensi di app — tiap scan dicatat `localStorage` (`ekoteologi_scan_perf`, maks 20) + teks "Analisis dalam X, Y detik" di sheet; (2) pengukuran E2E via API nyata mode mock: **MISS+LLM 38 ms, cache HIT 10 ms** (jauh di bawah target 2 dtk, *dengan catatan mock*); (3) unit test 18 + component test; (4) **APK debug sukses di-build** (5,7 MB). QA kamera lintas vendor menunggu perangkat — catat §7 |
| Admin: dashboard shell + KPI cards (data read-only) | 1 | ✅ | `DashboardView.vue` + `KpiCard.vue` — 4 kartu mockup `admin/index.html` dari `GET /v1/admin/kpi` (endpoint baru, role panel): Pengguna (+baru 7 hr), Scan Hari Ini (+total), Antrian Verifikasi, Cache LLM Hit Rate; skeleton/error/Segarkan; biaya LLM & grafik tertulis eksplisit "menyusul Sprint 4" |

**Gate (plan §5.3):** event `scan_pertama` (PRD §8 — aktivasi) ✅ — tabel `analytics_events`
(migrasi `be22b49a6dc5`), service `metrics.track_event()`, teruji pytest + terverifikasi di
DB & log pada smoke E2E.

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Endpoint baru** (`app/api/scan_history.py`, prefix `/v1/scans`):
  - `GET /v1/scans` — riwayat milik user (terbaru dulu), filter `category_id`, offset
    pagination (`limit` 1–50), respons `{items, total, limit, offset}`.
  - `GET /v1/scans/categories` — kategori seed utk filter chips (`base_points` ikut).
  - `GET /v1/scans/quota` — baca kuota TANPA konsumsi slot (GET, bukan INCR): `{used,
    limit, remaining, resets_in_seconds}`; Redis mati → 503 dan UI menyembunyikan pill
    (degrade informatif; kontras dgn `POST /v1/scan` yang fail-closed mutlak).
- **Gate aktivasi** (`app/api/scan.py` + `app/services/metrics.py`): event
  `scan_pertama` dicatat saat scan PERTAMA user (dihitung sebelum baris baru) — ikut
  transaksi yang sama dengan ledger sehingga tidak ada event "hantu"; payload
  `{scan_id, category, points}`; nama event terkurasi konstanta `EVENT_SCAN_PERTAMA`.
- **Admin KPI** (`app/api/admin_dashboard.py`): `GET /v1/admin/kpi` (role
  admin|verifier|editor) → users total/baru-7hr, scans hari ini/total, antrian verifikasi
  (`user_missions` status `pending` — terisi mulai Sprint 4), cache hit/miss/hit-rate dari
  penghitung Redis Sprint 2.
- **Model + migrasi**: `analytics_events` (append-only, index `name`) — migrasi
  `be22b49a6dc5` (autogenerate, sudah `upgrade head` lokal & test DB).
- **Service**: `scan_limit.peek_quota()` + `scan_limit.seconds_until_reset()`.
- **Test**: 89 → **101** (riwayat 6: filter/pagination/kuota/Redis-mati/kategori/auth;
  admin KPI 4: role guard, angka vs data, kosong; event `scan_pertama` 1).

### 3.2 Mobile (`mobile/`)

- **`views/ScanView.vue`** (signature, 5 poin): seluruh scene dari mockup — `.cam`
  (video live + scrim gradient), `.scan-frame` (4 corner emas, grid 3×3, dashed border →
  solid saat `found`), sweep ambient 2.2s (hanya saat idle; dihormati
  `prefers-reduced-motion` global tokens), status pill (`role=status aria-live=polite`):
  idle / "Menganalisis objek…" (spinner) / "Objek terdeteksi!" / error; shutter + flash;
  **sheet hasil** dengan stagger 6 tahap 50ms, tag kategori memakai token kategori
  (`--cat-*`), chip `+N POIN`, catatan duplikat, saran pembuangan, kutipan
  (`text` + `source` dari bank server), footer "Analisis dalam X, Y detik · dari cache";
  aksi "Saya Sudah Pilah (+N Poin)" → toast → reset; "Riwayat" & "Scan Lagi".
  **Sheet error** per mode gagal (429 kuota + estimasi reset dari `Retry-After`; 502
  gagal mengenali + 3 tips kualitas foto dari mockup; 413/400 foto; status 0 luring).
  Fokus pindah ke judul sheet saat terbuka; shutter disabled saat menganalisis.
- **`services/camera.ts`**: `getUserMedia` kamera belakang (ideal 1920, fallback
  graceful), capture frame → JPEG ≤1280px kualitas 0.85 via canvas (hemat kuota & byte
  upload), torch best-effort via `applyConstraints` (tombol disembunyikan bila tak
  didukung), stop track saat meninggalkan layar; `pickFromGallery()` (input file
  sementara) sebagai fallback statis; `CameraUnavailableError` dengan `reason`
  (denied/notfound/busy/unsupported) → pesan permission card yang tepat.
- **`views/HistoryView.vue`**: header melengkung + kembali + scan baru; filter chips
  horizontal (Semua + kategori), kartu riwayat (thumbnail foto, nama, tag kategori,
  waktu, chip poin — poin 0 diredupkan), label grup hari, "Muat lagi", state lengkap.
- **Integrasi poin/kuota**: `stores/auth.ts.applyPoints()` (total poin header/profil
  ikut naik tanpa refetch); `utils/scan.ts` (murni + teruji): `describeScanError`
  (peta status→konten sheet), `formatLatency` (gaya id-ID), `quotaLabel`,
  `formatRetryAfter`, `recordLatency/readLatencies` (uji lapangan).
- **Consent**: `components/scan/ConsentCard.vue` (role=dialog, 3 poin privasi: unggah
  utk analisis AI, tersimpan di riwayat milik sendiri, dapat dihapus atas permintaan —
  PRD §9) + `utils/consent.ts` (localStorage `ekoteologi_consent_foto`, teruji).
- **Home**: FAB & kartu menu "Scan Sampah AR" → `/scan`; kartu "Riwayat Scan" →
  `/riwayat` dgn hitungan nyata (`{N} scan tercatat` / "Belum ada scan" / best-effort);
  kartu Misi/E-Learning tetap pola "menyusul" mockup.
- **Router**: `/scan`, `/riwayat` (requiresAuth); BottomNav FAB tidak lagi toast
  placeholder.
- **`api/client.ts`**: `ApiError.retryAfterSeconds` (header `Retry-After` diparse) —
  kontrak UI 429.

### 3.3 Admin (`admin/`)

- **`components/KpiCard.vue`** (pola `.panel.kpi` mockup) + **`DashboardView.vue`**
  ditulis ulang: 4 KPI cards read-only dari `GET /v1/admin/kpi`, state skeleton
  (grid 4 kartu), error + Coba Lagi (`role=alert`), tombol Segarkan, angka
  `Intl.NumberFormat('id-ID')`, panel catatan "Menyusul Sprint 4" (grafik + biaya LLM,
  mode mock = Rp0). Placeholder "Belum ada data dashboard" & kartu Akun Aktif dihapus
  (identitas sudah ada di topbar/sidebar).

### 3.4 Tooling & dokumentasi

- **Vitest** di mobile (vitest 5 + `@vue/test-utils` + happy-dom): script `npm test`;
  18 test (helper `utils/scan`, `utils/datetime`, `utils/consent`, component
  `ConsentCard`). CI job mobile kini `lint → test → build` (satu-satunya perubahan CI).
- README api (endpoint baru, arsitektur metrik), mobile (arsitektur scan, kamera,
  consent, test), admin (dashboard KPI) diperbarui.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 101 lulus, coverage 88% (gate 70%) |
| Vitest | `npm test` (mobile) | ✅ 18 lulus (3 file: scan, consent, consent-card) |
| ruff + eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses |
| E2E scan → poin → riwayat → kuota → KPI | curl/python ke uvicorn lokal (mock LLM) | ✅ register→scan 200 (+5 poin, `points_total` 5)→riwayat total=2 & filter→kuota `used=2 remaining=18`→profil poin 5 (Lvl 1 Pemula)→admin KPI angka konsisten; role user → 403 |
| Latensi (uji lapangan pengganti) | perf_counter di klien E2E | ✅ MISS+mock LLM 38 ms; duplikat/HIT 10 ms — ≪ target 2 dtk (*mode mock; provider live menunggu staging — §7*) |
| Event `scan_pertama` | DB + log smoke | ✅ baris `analytics_events` (`name=scan_pertama`, payload lengkap); log `EVENT scan_pertama user=… scan=10 (aktivasi — PRD §8)`; hanya 1 walau scan ke-2 sukses (test) |
| 429 kuota harian | test (`scan_daily_limit=2`) | ✅ 429 + `Retry-After` > 0; UI: sheet "Kuota Scan Habis" + `Coba Lagi` → kamera |
| Redis mati (quota read) | test: stub `RedisError` | ✅ `/v1/scans/quota` 503 — UI menyembunyikan pill, scan tetap ditolak fail-closed (perilaku Sprint 2 tak berubah) |
| APK debug | `./gradlew assembleDebug` (JDK 21 + SDK lokal) | ✅ `app-debug.apk` 5,7 MB (setelah `cap sync` dgn dist final); CI juga memproduksinya |
| CI GitHub | run #8 (`203d969`) | ✅ sukses — api, admin, mobile (kini termasuk vitest), android-apk (4 job) |
| Perangkat Android nyata | — | ⚠️ Belum (tidak ada perangkat terhubung) — kamera live preview hanya terverifikasi lewat implementasi API standar + fallback galeri; QA matrix vendor menunggu perangkat |

---

## 5. Keputusan & Catatan Teknis

1. **Kamera via `getUserMedia` + fallback galeri, tanpa plugin native** (risiko plan §6:
   camera-preview tidak konsisten antar vendor): WebView modern (dan Chrome) mendukung
   `getUserMedia` — preview live bekerja di browser dev (uji via Wi-Fi `VITE_API_URL`)
   dan di WebView Android selama izin kamera diberikan. Fallback `@capacitor/camera`
   diimplementasikan setara via input file statis (`pickFromGallery`) tanpa dependensi
   baru — memenuhi mitigasi "ambil foto statis" dengan nol churn native. Plugin native
   baru dievaluasi lagi saat QA matrix perangkat (Sprint 8) — sebelum perangkat nyata
   tersedia, menambah plugin justru menambah kode tak teruji.
2. **Bagian mockup yang sengaja tidak dibangun**: seksi "Lama Penguraian" (450 tahun)
   pada sheet hasil tidak ada padanannya di kontrak `POST /v1/scan` yang sudah final
   (Sprint 2) — menampilkan data rekaan melanggar prinsip "quote/data dari server".
   Sekti itu hidup otomatis bila kontrak nanti menambah field (mis. `decomposition`).
   Tombol "Cara Mengolah?" diganti aksi fungsional (Riwayat/Scan Lagi).
3. **Kuota harian dibaca tanpa konsumsi**: `peek_quota` memakai GET Redis (bukan INCR)
   sehingga membuka layar scan tidak menghanguskan kuota; endpoint `/v1/scans/quota`
   503 saat Redis mati dan UI hanya menyembunyikan pill — informasi terdegradasi, bukan
   fitur yang diblokir (kontras dengan `POST /v1/scan` yang tetap fail-closed mutlak).
4. **`Retry-After` sampai ke microcopy**: `ApiError` kini membawa
   `retryAfterSeconds`; sheet 429 menampilkan estimasi reset ("sekitar 9 jam 12 menit
   lagi"). "Coba Lagi" pada 429 sengaja TIDAK mengunggah ulang (pasti gagal lagi) —
   kembali ke kamera; untuk 502 foto yang sama diunggah ulang tanpa jepret baru.
5. **Event aktivasi = bagian dari transaksi scan**: `scan_pertama` dihitung sebelum
   insert (`COUNT(scans user)==0`) dan ditulis via `track_event()` dalam transaksi yang
   sama dengan ledger — request gagal di tengah tidak meninggalkan event. Tabel
   append-only; event `misi_selesai`, `modul_selesai`, `streak_hari` menyusul lewat
   pintu yang sama.
6. **Consent foto disimpan lokal dulu (MVP)**: prasyarat unggah sudah ada sekarang
   (scan), sedangkan catatan consent server-side + retensi/penghapusan adalah keputusan
   terbuka §2.1 #6 yang rencananya ditutup sebelum Sprint 4 (bukti misi bisa memuat
   wajah). `ConsentCard` dibuat reusable agar Sprint 4 tinggal memakai + mencatat ke DB.
7. **Antrian verifikasi di KPI dihitung dari `status='pending'`** — nilai yang akan
   dipakai modul verifikasi (Sprint 4–5, badge mockup "Menunggu"); sekarang memang 0
   karena belum ada klaim misi, kartu tetap tampil jujur dengan angka 0.
8. **Vitest masuk CI (mobile)**: DoD menuntut test untuk logika baru; logika UI murni
   (peta error, format latensi, kuota, consent) kini teruji di sisi klien juga. Admin
   belum punya test runner (logika dashboard tipis; pemakaian API ditutup pytest) —
   ditunda sampai ada logika yang pantas diuji.
9. **Deteksi kategori memakai warna token kategori** (`--cat-*`): Kertas/Kaca/Logam
   tidak punya pasangan token sendiri → memakai token tetangga yang kontras-aman
   (Residu/Plastik/netral). Penambahan token kategori baru adalah keputusan desain
   terpisah (satu sumber di `docs/desain/tokens.css`).

---

## 6. DoD Sprint 3 — Checklist

- [x] CI hijau di GitHub: run #8 pada `203d969` **success** (4/4 job) — api (ruff + 101
      pytest + coverage gate 70%), admin, mobile (**lint + vitest + build**),
      android-apk + artefak APK. Verifikasi lokal: 101 pytest, 18 vitest, lint bersih,
      coverage 88%.
- [x] Unit/component test logika baru: API (riwayat/kuota/KPI/event 11 test baru),
      mobile (18 vitest — helper scan/datetime/consent + component ConsentCard).
- [x] UI 100% dari `tokens.css` — ScanView/HistoryView/KpiCard nol hardcode warna/jarak
      (satu-satunya nilai non-token: nilai desain dari mockup seperti 26px corner /
      72px shutter yang juga tercantum literal di mockup; angka & teks via Intl id-ID).
- [x] State lengkap: scan (permission, idle, analyzing, hasil, error per-mode, kuota
      habis), riwayat (skeleton, empty per-filter, error+retry, offline-bar global,
      "Muat lagi"), admin dashboard (skeleton, error+retry, data).
- [x] Aksesibilitas: tap target ≥44px (shutter 72, icon-btn 44, chips 44, tombol 48),
      `aria-live` status, `role=dialog` + fokus ke judul sheet/kartu, `aria-pressed`
      chips/torch, ikon `aria-hidden`, `prefers-reduced-motion` & `:focus-visible`
      global dari tokens.css.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata — **belum** (tidak ada perangkat terhubung,
      item terbuka sejak Sprint 0). Pengganti terukur: E2E alur via API nyata + browser
      web (getUserMedia), APK debug sukses, instrumen latensi tertanam. QA kamera
      lintas vendor dilampirkan ke demo perangkat (§7).
- [x] Terdokumentasi: `api/README.md` (endpoint + metrik), `mobile/README.md`
      (arsitektur scan/kamera/consent/test), `admin/README.md` (KPI), laporan ini.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Perangkat Android nyata** (terbuka sejak Sprint 0) | QA kamera lintas vendor (plan §6) + uji latensi live belum bisa; kamera preview & izin WebView baru teruji di browser | Demo scan ke PO segera setelah perangkat tersedia (APK siap: `adb install`) |
| 2 | **Hosting staging + `LLM_API_KEY`** (terbuka sejak Sprint 0) | Latensi/kualitas analisis provider vision asli belum terukur (semua angka sprint ini = mode mock); target hasil <2 dtk baru teruji sungguhan setelah live | **Segera** — sebelum demo dengan provider asli |
| 3 | Consent server-side + retensi/penghapusan (§2.1 #6) | Consent scan saat ini lokal-perangkat; bukti misi (bisa memuat wajah) wajib punya catatan server | Sebelum Sprint 4 (sesuai deadline rencana) |
| 4 | Sisa wiring Google Sign-In native + OAuth Client ID (Sprint 1) | Tidak memblokir Sprint 4 | Fleksibel |

---

## 8. Yang Menyusul (Sprint 4 — Misi: Klaim & Data)

CRUD misi (admin), klaim misi photo (konsentrasi consent server-side — kartu
`ConsentCard` sudah reusable), UI daftar misi + tab harian/pencapaian (`misi.html`),
anti dobel klaim (constraint DB), admin tabel pengguna, dan dashboard admin 2 chart
(scan harian & kategori — data scans sudah tersedia). Kontrak yang sudah siap:
`analytics_events`, KPI `verification.pending`, dan pola endpoint riwayat.
