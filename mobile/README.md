# Mobile — Ekoteologi AR (Vue + Capacitor)

User app Android. Acuan visual: `docs/desain/mobile/` (mockup D1) + `docs/DESIGN.md`.
Frame aplikasi 480px terpusat di desktop, safe-area (`viewport-fit=cover` +
`env(safe-area-inset-bottom)` di `.nav-wrap`).

## Perintah

```bash
npm ci
npm run dev        # web dev server http://localhost:5173 (host: true untuk uji via Wi-Fi)
npm run lint
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

## Struktur & catatan

- `capacitor.config.ts` — appId `id.ekoteologi.app`, `webDir: dist`, `androidScheme: https`.
- `src/styles/tokens.css` — salinan `docs/desain/tokens.css` (satu sumber di docs).
- `src/styles/base.css` — salinan mockup `base.css` minus bagian demo-bar (khusus mockup).
- Komponen inti `src/components/ui/`: Button, Card, Chip, Input, Tabs, Skeleton, ToastHost.
- `src/views/HomeView.vue` — placeholder beranda (header melengkung + bottom nav + FAB);
  home penuh dirakit di Sprint 3–6, auth Sprint 1, scan Sprint 3.
- Font & ikon di-bundle lokal (fontsource + `@fortawesome/fontawesome-free@6`) agar app
  berjalan offline — tanpa CDN.
