# Checklist Rilis Play Store — Internal Testing (Sprint 8)

> Goal plan Sprint 8: "MVP rilis ke internal testing Play Store". Lingkungan
> kerja ini **tidak punya akun Play Console / kredensial FCM / perangkat
> fisik** (item terbuka sejak Sprint 0), jadi langkah yang menyentuh akun dan
> perangkat adalah checklist manual untuk PO/dev — semuanya sudah disiapkan
> di repo: kode, build, deklarasi izin, dan release notes.

## 0. Prasyarat akun (item terbuka — butuh PO)

- [ ] Akun **Google Play Console** (biaya pendaftaran satu kali; verifikasi
  identitas organisasi).
- [ ] **Google Cloud project** + Firebase (satu project untuk FCM):
  - [ ] Service account dengan role *Firebase Cloud Messaging API Sender* →
    unduh JSON → simpan aman → set `FCM_CREDENTIALS_FILE` + `FCM_PROJECT_ID`
    + `PUSH_MODE=fcm` di server.
  - [ ] (Opsional, bisa menyusul) `google-services.json` di
    `mobile/android/app/` bila ingin analitik Firebase natif.
- [ ] **OAuth Client ID** Google (menuntaskan sisa Google Sign-In — Sprint 1).
- [ ] **Sentry project** → isi `SENTRY_DSN` di server (tanpa DSN tidak aktif).
- [ ] Hosting API produksi + domain (staging juga item terbuka sejak Sprint 0).

## 1. Kunci tanda tangan (release key)

```bash
keytool -genkey -v -keystore ekoteologi-release.keystore \
  -alias ekoteologi -keyalg RSA -keysize 2048 -validity 10000
```

- Simpan `.keystore` + kata sandi di password manager PO — **jangan di-commit**
  (`.gitignore` sudah menutup `*.keystore`/`*.jks`).
- Set env di mesin build / CI secrets:
  `EKO_STORE_FILE`, `EKO_STORE_PASSWORD`, `EKO_KEY_ALIAS`, `EKO_KEY_PASSWORD`.
- Tanpa env ini build tetap jalan tetapi menghasilkan **unsigned** AAB
  (`app-release.aab` tanpa tanda tangan) — tidak bisa diunggah ke Play.
  Lokal sudah terbukti: `./gradlew bundleRelease` BUILD SUCCESSFUL.

## 2. Build artefak

```bash
cd mobile
npm ci && npm run build
npx cap sync android
cd android
./gradlew bundleRelease          # AAB untuk Play Store
./gradlew assembleDebug          # APK debug utk uji adb install
```

- versionCode/versionName dari env `EKO_VERSION_CODE` / `EKO_VERSION_NAME`
  (default 1 / 1.0.0). Naikkan versionCode untuk setiap unggah berikutnya.
- Untuk uji internal cepat sebelum konsol siap: `adb install app-debug.apk`.

## 3. Deklarasi izin (PRD §9 — risiko "Play Store menolak")

Manifest sudah berisi (lihat `mobile/android/app/src/main/AndroidManifest.xml`):

| Izin | Kapan diminta | Justifikasi utk form Play |
|---|---|---|
| `INTERNET` | otomatis | Mengakses API Ekoteologi. |
| `CAMERA` | saat membuka layar Scan / unggah bukti | **"Kamera — memindai sampah dengan bantuan AI & mengambil foto bukti misi (opsional)."** Hanya saat dipakai, tidak di latar belakang. |
| `POST_NOTIFICATIONS` (13+) | saat masuk app | "Menerima hasil verifikasi misi, misi baru, dan pengingat streak." |
| `uses-feature camera required=false` | — | Perangkat tanpa kamera tetap bisa memasang. |

Isi juga di Play Console:

- [ ] **App content → Data safety**: kumpulkan email, nama, kota, foto
  (bukti misi + scan). Foto disimpan di server, consent dicatat server-side
  (`user_missions.consent_at`), bukti bisa dihapus atas permintaan.
  Data tidak dijual; dibagikan ke penyedia analisis AI (isi sesuai provider
  final saat `LLM_API_KEY` live).
- [ ] **Kebijakan privasi** — **butuh URL publik dari PO** (domain masih item
  terbuka). Poin yang harus ada: pengumpulan data di atas, consent, retensi,
  kontak penghapusan.
- [ ] **AI-generated content policy** (deklarasikan fitur AI in-app): analisis
  foto sampah oleh model visi. Mitigasi yang sudah dibangun: output tervalidasi
  skema, kutipan agama **selalu dari bank terkurasi** (tidak digenerasi AI —
  PRD §9), poin dibatasi `base_points` kategori.
- [ ] **Content rating** questionnaire: tanpa konten dewasa/kekerasan.
- [ ] **Target audience**: umum dewasa (bukan target anak — wajib konsisten
  dgn keputusan PO).
- [ ] Kategori aplikasi & tag; deskripsi singkat + lengkap ( Bahasa Indonesia).
- [ ] **Screenshots** (min. 2) + ikon 512×512 + feature graphic 1024×500 —
  ambil dari build debug di perangkat/emulator (layar Beranda, Scan, Misi,
  Belajar).

## 4. Unggah internal testing

- [ ] Testing → Internal testing → buat release `1.0.0 (1)` → unggah AAB.
- [ ] Catatan rilis: salin dari `docs/release/RELEASE-NOTES-v1.0.0.md`.
- [ ] Tambah tester (email list internal) → bagikan link opt-in.
- [ ] Rollout 100% untuk jalur internal (aman — audiens terbatas).

## 5. QA manual saat perangkat tersedia (gabungan Sprint 8)

Jalankan matriks di `docs/qa/DEVICE-MATRIX.md` — hasil ditempel ke laporan
sprint berikutnya / demo review PO.

## 6. Setelah rilis

- [ ] Pantau error: Sentry (setelah DSN aktif) + `GET /v1/admin/metrics/events`
  utk aktivasi `scan_pertama` (target PRD §8 ≥40%).
- [ ] Kumpulan feedback tester → backlog review Sprint berikutnya.
