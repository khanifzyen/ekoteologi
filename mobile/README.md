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

## Struktur & catatan

- `capacitor.config.ts` — appId `id.ekoteologi.app`, `webDir: dist`, `androidScheme: https`.
- `src/styles/tokens.css` — salinan `docs/desain/tokens.css` (satu sumber di docs).
- `src/styles/base.css` — salinan mockup `base.css` minus bagian demo-bar (khusus mockup).
- `src/styles/app.css` — gaya di luar mockup D1 (splash/onboarding/auth/profil), tetap 100% token.
- Komponen inti `src/components/ui/`: Button, Card, Chip, Input, Tabs, Skeleton, ToastHost.
- Komponen state `src/components/state/` (Sprint 1): StateSkeleton, StateEmpty, StateError,
  OfflineBar (bar "luring" otomatis via event `online`/`offline`).
- `src/components/scan/ConsentCard.vue` — kartu persetujuan foto (PRD §9),
  reusable untuk unggah bukti misi (Sprint 4).
- `src/components/layout/BottomNav.vue` — nav bawah + FAB bersama (FAB → `/scan`).
- `src/views/`: OnboardingView, AuthView, HomeView (menu scan/riwayat + level),
  ScanView (signature, Sprint 3), HistoryView (riwayat + filter, Sprint 3),
  ProfileView.
- `src/services/`: `camera.ts` (getUserMedia + capture JPEG + torch + galeri),
  `scan.ts` (endpoint `/v1/scan*`). `src/utils/` — `scan.ts` (latensi, peta
  error, kuota; teruji vitest), `datetime.ts`, `consent.ts`.
- `src/stores/auth.ts` — sesi Pinia (login/daftar/refresh/profil/avatar/logout
  + `applyPoints`).
- Test: `npm test` (vitest + happy-dom) — unit helper `src/utils` + component
  `ConsentCard`.
- Font & ikon di-bundle lokal (fontsource + `@fortawesome/fontawesome-free@6`) agar app
  berjalan offline — tanpa CDN.
