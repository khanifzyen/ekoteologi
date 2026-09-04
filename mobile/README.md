# Mobile — Ekoteologi AR (Vue + Capacitor)

User app Android. Acuan visual: `docs/desain/mobile/` (mockup D1) + `docs/DESIGN.md`.
Frame aplikasi 480px terpusat di desktop, safe-area (`viewport-fit=cover` +
`env(safe-area-inset-bottom)` di `.nav-wrap`).

## Perintah

```bash
npm ci
npm run dev        # web dev server http://localhost:5173 (host: true untuk uji via Wi-Fi)
npm run lint
npm test           # vitest (unit + component test — Sprint 3)
npm run build      # vue-tsc + vite build → dist/

npm run cap:sync   # build web + salin ke proyek Android
npm run apk        # build APK debug → android/app/build/outputs/apk/debug/app-debug.apk
```

## Build APK debug lokal (Linux)

Butuh JDK 21 + Android SDK (platform 35/36, build-tools). Contoh setup tanpa sudo:

```bash
# JDK 21
curl -sL -o /tmp/jdk21.tgz "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse"
mkdir -p ~/jdk21 && tar -xzf /tmp/jdk21.tgz -C ~/jdk21 --strip-components=1

# Android cmdline-tools + paket
curl -sL -o /tmp/ct.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
mkdir -p ~/android-sdk/cmdline-tools && python3 -m zipfile -e /tmp/ct.zip /tmp/ct/
mv /tmp/ct/cmdline-tools ~/android-sdk/cmdline-tools/latest && chmod -R +x ~/android-sdk/cmdline-tools/latest/bin
export JAVA_HOME=~/jdk21 ANDROID_HOME=~/android-sdk
yes | ~/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses
~/android-sdk/cmdline-tools/latest/bin/sdkmanager "platform-tools" "platforms;android-35" "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0"

# Build
export JAVA_HOME=~/jdk21 ANDROID_HOME=~/android-sdk
npm run apk
```

Pasang di perangkat: `adb install android/app/build/outputs/apk/debug/app-debug.apk`.

## Konfigurasi & alur aplikasi (Sprint 1)

Salin `.env.example` → `.env` bila perlu override:

| Var | Default | Keterangan |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8100` | Base URL API. Saat uji di perangkat via Wi-Fi, isi IP LAN mesin dev, mis. `http://192.168.1.10:8100` |
| `VITE_GOOGLE_CLIENT_ID` | kosong | Web Client ID Google. Kosong → tombol Google memberi pesan bahwa fitur belum aktif |

Alur: splash → onboarding 3 slide (sekali, ditandai `ekoteologi_onboarded` di
localStorage) → masuk/daftar (`AuthView`, mockup `auth.html`) → beranda.
Guard router: layar beranda/profil butuh sesi; user yang sudah masuk tidak
melihat layar masuk lagi.

Sesi: pasangan access+refresh JWT disimpan di localStorage klien
(`ekoteologi_access` / `ekoteologi_refresh`). `src/api/client.ts` mengulang
request sekali setelah refresh sukses; gagal → sesi dibuang → kembali ke
layar masuk. Keluar: tombol di `ProfileView`.

Google Sign-In: endpoint API `/v1/auth/google` sudah siap (verifikasi ID token
di server). Sisi klien native menunggu (1) OAuth client dari Google Cloud dan
(2) plugin komunitas yang kompatibel Capacitor 8 (plugin `@codetrix-studio`
masih peer Capacitor 6) — lihat catatan di `src/services/googleAuth.ts`.

## Scan AI (Sprint 3)

Alur signature: FAB beranda → `/scan` (`ScanView`, mockup `scan.html`, polish 1:1):
consent foto (PRD §9, kartu `ConsentCard`) → izin kamera → preview + overlay
frame (garis sudut, grid, sweep ambient) → shutter (flash) → `POST /v1/scan` →
sheet hasil slide-up dengan stagger (nama item, tag kategori, chip `+N POIN`,
saran pembuangan, kutipan dari bank server) → "Saya Sudah Pilah (+N Poin)".
Sheet error memetakan 429 (kuota harian + reset dari header `Retry-After`),
502 (gagal mengenali + tips kualitas foto), 413/400 (foto), 0 (luring).

- **Kamera**: preview langsung via `getUserMedia` (WebView/browser standar,
  `src/services/camera.ts`) — tanpa plugin native, sesuai mitigasi risiko
  plan §6 (plugin camera-preview tidak konsisten antar vendor). Fallback
  resmi: **Pilih dari Galeri** (input file statis, setara `@capacitor/camera`
  tanpa dependensi). Torch best-effort (hanya bila track mendukung).
  Foto di-capture ke JPEG ≤1280px (hemat kuota & unggah).
- **Consent foto** (`src/utils/consent.ts`): disimpan lokal
  (`ekoteologi_consent_foto`); wajib disetujui sebelum unggah pertama.
  Pencatatan consent di server menyusul Sprint 4 bersama bukti misi.
- **Poin & kuota**: `points_total` dari respons disinkronkan ke auth store;
  sisa kuota ditampilkan via `GET /v1/scans/quota` (pill di bawah status),
  disembunyikan bila API tidak tersedia. Latensi tiap scan dicatat di
  localStorage (`ekoteologi_scan_perf`, maks 20 entri) untuk uji lapangan.
- **Riwayat**: `/riwayat` (`HistoryView`) — filter chips kategori
  (`GET /v1/scans/categories`), dikelompokkan Hari ini/Kemarin/tanggal,
  pagination "Muat lagi", state skeleton/empty/error lengkap.

## Misi (Sprint 4)

`/misi` (`MissionsView`, mockup `misi.html`): header melengkung dgn panel
**Progres misi minggu ini** (`{week_done}/{week_total} · +week_points poin`,
progressbar ber-ARIA) + chip "N misi baru", dan dua tab:

- **Harian** — kartu misi (`MissionCard`) dengan 4 keadaan: bisa diklaim
  (tombol Unggah Bukti/Klaim Poin + catatan consent), auto_scan (progres bar
  "2 dari 3 · otomatis dari scan" — diisi Sprint 5), menunggu verifikasi
  (aksen info), selesai (aksen hijau), ditolak (catatan admin + Unggah Ulang).
- **Pencapaian** — grid lencana (`GET /v1/badges`): diraih vs terkunci;
  pemberian otomatis menyusul badge engine Sprint 6 (data tampil jujur).

Alur klaim photo: tombol Unggah Bukti → **consent foto** (kartu reusable
`ConsentCard`, PRD §9) → pilih Kamera (`input capture=environment`) atau Galeri
(tanpa plugin native) → pratinjau → Kirim Bukti → `POST /v1/missions/{id}/claim`
(klaim masuk antrian `pending`, consent tercatat server). Error klaim
dipetakan `describeClaimError` (409 dobel/periode, 400 consent/mode, 413 ukuran,
0 luring — foto tetap tersimpan utk kirim ulang).

## Sprint 5 — verifikasi, misi manual/auto_scan, streak, notif in-app

- **Loop misi tertutup**: chip status kartu (`MissionCard`) kini hidup —
  "Menunggu verifikasi admin" → "Selesai · +N poin" atau "Perlu diperbaiki"
  (dengan catatan admin) setelah verifier memutuskan di panel admin. Hasil
  verifikasi juga masuk **notifikasi in-app** (`GET /v1/notifications`);
  begitu daftar misi dibuka, notifikasi `mission` ditandai dibaca, dan
  kartu menu **Misi** di beranda menampilkan "N hasil verifikasi baru"
  selama ada yang belum dibaca. (Push FCM menyusul Sprint 6.)
- **Klaim manual**: tombol **Klaim Poin** (misi verification `manual`) langsung
  memanggil endpoint klaim → auto-approve → toast "+N poin langsung masuk";
  poin tersinkron ke header (`auth.addPoints` + profil disegarkan agar level
  ikut). Tombol menampilkan spinner per-kartu saat mengirim.
- **Misi auto_scan**: progres (`progress_count`) kini diisi otomatis oleh scan
  bernilai poin di server — kartu "2 dari 3 · otomatis dari scan" hidup;
  selesai otomatis → kartu done + poin.
- **Streak harian** (beranda): kartu **StreakCard** (pola `streak-card`
  `beranda.html`) dari `GET /v1/streak` — judul "Streak N hari!", kalimat
  motivasi bonus ("… N hari lagi untuk bonus +20 poin"), dan kalender 7 hari
  (lingkaran inisial hari Indonesia, hari ini di-outline, `role=img` +
  `aria-label`). Helper murni di `utils/streak.ts` (teruji vitest); skeleton
  saat memuat dan kartu disembunyikan bila API gagal (pola best-effort beranda).
- Level di header tetap dari profil — kini dihitung server lewat level engine
  (`services/levels` di API) dan ikut menyesuaikan setelah poin berubah.

## Sprint 6 — beranda final, badge engine, konten harian, push FCM

- **Beranda susunan final** (`HomeView.vue` — 1:1 `beranda.html`): header
  melengkung kini menampilkan blok **Poin Kebaikan** + avatar + pill level;
  diikuti StreakCard (Sprint 5), **ImpactCard "Pohon Kebaikanmu"**
  (tahap Bibit → Tunas → Pohon Muda → Pohon Subur → Pohon Mangga dari total
  aksi nyata = scan bernilai poin + misi disetujui — angka server, teks di
  `utils/impact.ts` teruji vitest), **WisdomCard "Kutipan Hari Ini"** (dari
  `GET /v1/daily-content`; tombol Bagikan memakai Web Share API, fallback =
  salin ke clipboard + toast), seksi **Misi Hari Ini** (maks. 2 mini misi —
  auto_scan berjalan & misi bisa diklaim, diurutkan; `utils/home.ts` teruji),
  dan **Menu Utama** lengkap (Scan "AR" span-2, E-Learning "Segera hadir",
  Misi dgn badge hasil verifikasi baru, Komunitas toast Fase 2, Riwayat
  dgn hitungan). Setiap widget best-effort: skeleton sendiri, hilang bila
  API-nya gagal — satu widget mati tidak memblokir beranda.
- **Badge engine hidup**: tab Pencapaian layar Misi kini menampilkan lencana
  yang diraih **otomatis** dari aksi (scan pertama, misi, streak, poin —
  server mengevaluasi kriteria JSONB; lencana baru dinotifikasikan `type=info`).
- **Profil** (Sprint 6): statistik **Statistik Dampak** (Scan Bernilai /
  Misi Selesai / Lencana), bar **progres level** ("% menuju <level>"; server
  menghitung `level_progress`), grid 5 lencana (terrahiri & terkunci) + tautan
  ke tab Pencapaian.
- **Konten harian**: `services/dailyContent.ts` memanggil `GET
  /v1/daily-content` — konten terjadwal admin (ayat/hadis/refleksi + "Aksi
  hari ini") atau fallback bank quote terkurasi server (`fallback: true`,
  tanpa aksi). Label tipe & teks bagikan di `utils/daily.ts` (teruji).
- **Push FCM** (`services/push.ts` + `@capacitor/push-notifications`):
  saat berjalan di perangkat native, izin notifikasi diminta sekali per sesi
  dan token hasil registrasi dikirim ke `POST /v1/push/token` (hapus via
  `DELETE` saat logout — belum dipasang; logout MVP tidak menghapus token,
  catatan Sprint 7). Di browser (dev web) pendaftaran di-skip tanpa error —
  FCM butuh build native; pengiriman pesan nyata menunggu kredensial server
  (item terbuka Sprint 6).

## Sprint 7 — E-Learning, konten harian (refleksi), polish onboarding

- **Layar Belajar** (`ModuleListView.vue`, rute `/belajar`, tab bottom-nav
  "Belajar" kini aktif — bukan lagi "Segera hadir"): header dgn chip
  "N/M modul" dari ringkasan server, kartu **"Refleksi Hari Ini"**
  (WisdomCard dgn label prop — endpoint `GET /v1/daily-content` yang sama
  dgn beranda: satu sumber, tanpa duplikasi), dan daftar kartu modul
  (`module-card` mockup `elearning.html`): ikon, hitungan "N pelajaran ·
  kuis", bar progres (progressbar ARIA), label persen
  (Baru/N%/Selesai — `utils/elearning.ts` teruji), dan CTA server-driven
  (Mulai/Lanjutkan/Ulangi). State skeleton/empty/error + Coba Lagi.
- **Detail modul** (`ModuleDetailView.vue`, `/belajar/modul/:id`): ringkasan
  progres + CTA, daftar pelajaran (centang hijau yg selesai, seluruh baris
  tap target), kartu **Kuis Modul** (jumlah soal · ambang · hadiah poin +
  hasil terbaik saya), dan pesan jujur bila kuis belum disiapkan.
- **Pelajaran** (`LessonView.vue`, `/belajar/pelajaran/:id`): render blok
  JSONB sesuai mockup — paragraf, **kutipan** (teks Arab RTL + terjemahan +
  sumber, font arab), **tip** (kartu emas dgn lampu). "Tandai Selesai &
  Lanjut" → `POST /v1/lessons/{id}/complete` (progres berurutan server);
  pelajaran terakhir yang menuntaskan modul melompat ke kuis; "Lompat ke
  Kuis Modul" selalu tersedia.
- **Kuis** (`QuizView.vue`, `/belajar/modul/:id/kuis`): intro ("N soal ·
  lulus 70% · hadiah +20 poin" — angka server) → satu soal per layar dgn
  titik progres + validasi "pilih salah satu jawaban dulu" → kirim semua
  jawaban → penilaian otomatis server (kunci tidak pernah bocor sebelum
  submit). Poin lulus disinkronkan ke header (auth store).
- **Hasil** (`ResultView.vue`, `/belajar/modul/:id/hasil`): ring
  conic-gradient dgn skor (mockup `.ring`), judul "MasyaAllah, Lulus!",
  baris poin (+N / sudah pernah / ajakan coba lagi), **Bedah Jawaban**
  (kunci + penjelasan server, teks opsi dari snapshot kuis), tombol kembali.
  Hasil diteruskan via store memori `stores/quizResult.ts` — refresh di
  layar hasil kembali ke intro kuis (disengaja, hasil tidak dibuat-buat).
- **Onboarding + splash final** (`OnboardingView.vue`): splash kini menunggu
  font siap (`document.fonts.ready`, cap 2,5 dtk) + durasi minimum — tanpa
  FOUT saat slide tampil; navigasi geser (swipe ≥48px) & tombol panah
  keyboard; perpindahan slide diumumkan `aria-live=polite`.

## Struktur & catatan

- `capacitor.config.ts` — appId `id.ekoteologi.app`, `webDir: dist`, `androidScheme: https`.
- `src/styles/tokens.css` — salinan `docs/desain/tokens.css` (satu sumber di docs).
- `src/styles/base.css` — salinan mockup `base.css` minus bagian demo-bar (khusus mockup).
- `src/styles/app.css` — gaya di luar mockup D1 (splash/onboarding/auth/profil), tetap 100% token.
- Komponen inti `src/components/ui/`: Button, Card, Chip, Input, Tabs, Skeleton, ToastHost.
- Komponen state `src/components/state/` (Sprint 1): StateSkeleton, StateEmpty, StateError,
  OfflineBar (bar "luring" otomatis via event `online`/`offline`).
- `src/components/scan/ConsentCard.vue` — kartu persetujuan foto (PRD §9),
  dipakai layar Scan dan alur unggah bukti misi (Sprint 4).
- `src/components/missions/MissionCard.vue` — kartu misi 4 keadaan (teruji vitest).
- `src/components/home/StreakCard.vue` — kartu streak + kalender 7 hari (Sprint 5).
- `src/components/home/ImpactCard.vue` + `WisdomCard.vue` — kartu dampak &
  kutipan harian beranda (Sprint 6).
- `src/components/layout/BottomNav.vue` — nav bawah + FAB bersama (FAB → `/scan`,
  Misi → `/misi` aktif sejak Sprint 4).
- `src/views/`: OnboardingView, AuthView, HomeView (susunan final Sprint 6),
  ScanView (signature, Sprint 3),
  HistoryView (riwayat + filter, Sprint 3),
  MissionsView (misi + lencana + klaim photo/manual, Sprint 4–5), ProfileView
  (statistik dampak + lencana + progres level, Sprint 6).
- `src/services/`: `camera.ts` (getUserMedia + capture JPEG + torch + galeri),
  `scan.ts` (endpoint `/v1/scan*`), `missions.ts` (endpoint `/v1/missions*`,
  `/v1/badges`), `streak.ts` (`GET /v1/streak`), `notifications.ts`
  (`/v1/notifications*`), `dailyContent.ts` (`GET /v1/daily-content`),
  `push.ts` (registrasi token FCM — native saja). `src/utils/` —
  `scan.ts`, `missions.ts` (keadaan kartu, peta error klaim, progres),
  `streak.ts` (judul/hint/kalender), `impact.ts` (tahap pohon),
  `home.ts` (pemilihan mini misi), `daily.ts` (label tipe & share text),
  `datetime.ts`, `consent.ts` — sebagian besar teruji vitest.
- `src/stores/auth.ts` — sesi Pinia (login/daftar/refresh/profil/avatar/logout
  + `applyPoints`, `addPoints`, `refreshProfile`).
- Test: `npm test` (vitest + happy-dom) — unit helper `src/utils` + component
  `ConsentCard`, `MissionCard`.
- Font & ikon di-bundle lokal (fontsource + `@fortawesome/fontawesome-free@6`) agar app
  berjalan offline — tanpa CDN.
