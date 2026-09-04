# Device Matrix — QA Manual Ekoteologi AR (Sprint 8)

> Story plan Sprint 8: "QA cross-device Android (matrix vendor/ukuran
> 360–480px) — regresi semua layar vs mockup". Lingkungan kerja ini **tidak
> memiliki perangkat Android fisik** (item terbuka sejak Sprint 0), jadi
> matriks ini disiapkan lengkap agar QA manual bisa langsung dieksekusi
> begitu perangkat tersedia; regresi otomatis (pytest 275, vitest, smoke E2E
> lintas alur kritis, build APK/AAB) sudah dijalankan sebagai pengganti
> terukur — lihat `docs/sprint/sprint-8.md` §Verifikasi.

## 1. Matriks perangkat target

Sumber: plan §5.2 (Android 10–14, layar 360/390/430px, RAM 2GB) + frame
desain mobile 480px (`AUDIT.md` M9) + vendor utama pasar Indonesia.

| # | Vendor / model (contoh) | Android | Layar | RAM | Fokus regresi |
|---|---|---|---|---|---|
| D1 | Emulator AVD "pixel_5" | 14 | 393×851 | — | Baseline semua layar |
| D2 | Samsung Galaxy A-series (mis. A14) | 14 | 1080×2408 (~360dp) | 4 GB | Layar sempit 360dp, One UI font scale 1.3 |
| D3 | Xiaomi/Redmi (mis. Redmi 12) | 13 | 1080×2400 (~393dp) | 4/8 GB | MIUI: izin kamera per-app, battery saver vs push FCM |
| D4 | Pixel / Motorola (stok Android) | 12–13 | ~393–412dp | 4 GB | Baseline WebView & POST_NOTIFICATIONS runtime |
| D5 | Tablet / layar lebar (~480dp, mis. Galaxy Tab A) | 13 | ~480dp+ | 3 GB | Frame app terpusat 480px, FAB, bottom nav |
| D6 | Low-end (mis. Samsung A03, Android 11, 2–3 GB) | 11 | ~360dp | 2 GB | Cold start, kamera getUserMedia low-end, OOM scan besar |

Checklist tambahan lintas perangkat: `minSdk 24` (Android 7) tetap terpasang
walau di luar matriks — cukup smoke install, bukan regresi penuh.

## 2. Regresi semua layar vs mockup (per perangkat D1–D6)

Acuan visual: `docs/desain/mobile/*.html` + `AUDIT.md` (M1–M9) — apakah
susunan, radius, token warna, dan microcopy identik; jangan menilai pixel
dengan penggaris, nilai arah dan bahayanya (teks terpotong, kontras, tumpang
tindih safe-area).

- [ ] **Onboarding + splash** (`onboarding.html`) — 3 slide, dots, Lewati,
  swipe, splash tanpa FOUT; terpicu sekali.
- [ ] **Auth** (`auth.html`) — tab Masuk/Daftar, error per-field, 429,
  toggle kata sandi; tombol Google menampilkan pesan "belum aktif".
- [ ] **Beranda** (`beranda.html`) — header melengkung + Poin Kebaikan,
  StreakCard, kartu dampak pohon, Kutipan Hari Ini, mini misi, menu, FAB.
- [ ] **Scan** (`scan.html`) — izin kamera runtime (terima/tolak), preview
  hidup, frame + grid, shutter, sheet hasil (chip poin, saran, kutipan),
  sheet error 429/502/413/offline; `getUserMedia` di WebView tanpa crash.
- [ ] **Riwayat** — chips kategori, grup hari, "Muat lagi".
- [ ] **Misi** (`misi.html`) — 4 keadaan kartu + ditolak (catatan admin),
  tab Harian/Pencapaian, grid lencana, sheet unggah bukti + ConsentCard.
- [ ] **Belajar** (`elearning.html`) — chip "N/M modul", Refleksi Hari Ini,
  pelajaran (blok paragraph/quote arab-rtl/tip), kuis satu-soal-per-layar,
  ring hasil.
- [ ] **Profil** — statistik dampak, bar level, grid lencana, unggah avatar,
  keluar.
- [ ] **Notifikasi Sprint 8** — push masuk saat app foreground + background
  (misi approve, misi baru, streak reminder, broadcast admin); notifikasi
  in-app: broadcast tampil di list, badge `unread_count` tidak membengkak.
- [ ] **Offline-bar** global saat server tidak terjangkau (wifi off).
- [ ] **Rotation/locale**: id-ID penuh; angka & tanggal format Indonesia.

## 3. Matriks performa (kriteria demo Sprint 3)

| Uji | Target | Cara |
|---|---|---|
| Cold start app | <3 dtk (low-end <5 dtk) | `adb shell am start -W id.ekoteologi.app/.MainActivity` |
| Scan pertama (LLM live) | <2 dtk dgn cache (PRD §8 hit rate ≥70%) | teks "Analisis dalam X, Y detik" di sheet — instrumen tertanam sejak Sprint 3 (`ekoteologi_scan_perf`) |
| Ukuran APK/AAB | APK debug ±7,3 MB · AAB release ±5,7 MB | outputs Gradle |
| Push latency | <30 dtk setelah aksi admin | stopwatch saat composer push |

## 4. Vendor quirks yang dicari (plan §6 risiko #1)

- Xiaomi/MIUI: izin kamera "hanya saat dipakai" — pastikan preview tetap hidup.
- Samsung: font scale 1.3 + display size besar — cek terpotong pada chip poin
  & kalender streak.
- Battery saver agresi (MIUI/Oppo): push FCM datang setelah app dibuka —
  catat sebagai keterbatasan vendor, bukan bug aplikasi.
- WebView lama (Android 7–9): `getUserMedia` butuh izin WebView — kalau
  gagal, fallback galeri harus muncul (teks pesan sesuai mockup).

## 5. Hasil eksekusi

| Perangkat | Tanggal | Hasil | Catatan |
|---|---|---|---|
| — | — | **belum dieksekusi** (perangkat tidak tersedia) | item terbuka sejak Sprint 0 |
