# Laporan Sprint 1 — Auth & Onboarding

> Periode: 4 September 2026 · Kapasitas: 12 poin · Status: **selesai — 5 story diterima,
> 1 story (Google Sign-In native) selesai sebagian dengan alasan terdokumentasi**
> Goal sprint: **User baru bisa daftar → masuk → sampai beranda (kosong).**

---

## 1. Ringkasan

Alur pengguna baru end-to-end hidup: splash → onboarding 3 slide → daftar → beranda yang
menyapa nama asli pengguna. Di belakangnya, API mendapat registrasi, pasangan JWT
access+refresh dengan rotasi, rate limit login berbasis Redis, endpoint profil + unggah
avatar, Google Sign-In (sisi server), serta seed data awal (`waste_categories`, `levels`,
`badges`) — semuanya teruji: **51 test pytest hijau**, lint bersih di ketiga app, dan
verifikasi browser atas seluruh alur (termasuk error state).

Bukti cepat:

| Kriteria demo Sprint 1 | Hasil |
|---|---|
| Alur onboarding → login → beranda | ✅ Terverifikasi di browser (viewport 390×844): guard router mengarahkan `/` → `/onboarding`, splash → 3 slide → skip → masuk → daftar "Aisyah Putri" → beranda menyapa "Assalamu'alaikum, Aisyah" + pill "Lvl 1 · Pemula" dari seed |
| Error state tampil saat input salah | ✅ Form kosong → pesan per-field ("Masukkan alamat email yang valid.", "Kata sandi minimal 8 karakter."); kredensial salah → error box "Email atau kata sandi salah."; 5 gagal beruntun → 429 "Terlalu banyak percobaan masuk…" (test) |
| APK terpasang di perangkat | ⚠️ APK debug ter-build (`app-debug.apk` 5,5 MB, juga sebagai artefak CI); pemasangan ke perangkat nyata menunggu perangkat terhubung — sama dengan catatan Sprint 0 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Auth email+password, JWT refresh, rate limit login | 3 | ✅ | Register + login + refresh (rotasi, claim `rem` utk "Ingat saya" 30 hari vs 1 hari); rate limit Redis 5 gagal/15 mnt per email+IP, 429 dengan sisa menit |
| Google Sign-In (Capacitor) | 1 | 🟡 Sebagian | Endpoint `/v1/auth/google` **lengkap & teruji** (verifikasi tokeninfo, link by email, kolom `google_sub`). Wiring klien native menunggu: (1) OAuth Client ID dari Google Cloud (prasyarat akun §2.2), (2) plugin komunitas kompatibel Capacitor 8 (`@codetrix-studio` masih peer Cap 6 — diverifikasi via `npm view`). Tombol di layar masuk tampil sesuai mockup dan memberi pesan jelas saat belum dikonfigurasi |
| Onboarding + splash (3 slide, dots, skip) | 1 | ✅ | Sesuai mockup `onboarding.html`: splash (logo pop + loader) → 3 slide dgn dots dapat diklik, Lewati, Kembali/Lanjut; ditandai `ekoteologi_onboarded` agar tampil sekali |
| Profil dasar (nama, avatar, kota) + endpoint | 3 | ✅ | `GET/PATCH /v1/profile` (+`level`/`level_title` dihitung dari tabel levels), `POST /v1/profile/avatar` (magic bytes, ≤2 MB, disimpan `var/uploads`, dilayani `/uploads`); UI profil lihat/ubah + unggah avatar + keluar; header beranda menyapa nama asli |
| Komponen state (skeleton, empty, error, offline-bar, toast) | 1 | ✅ | `StateSkeleton`, `StateEmpty`, `StateError` (dgn Coba Lagi), `OfflineBar` (event online/offline); toast sudah ada dari Sprint 0 — kini dipakai nyata di auth/profil |
| Seed data awal + dokumentasi API | 3 | ✅ | `scripts/seed.py` idempoten (teruji dijalankan 2×): 7 kategori sampah, 10 level (0→2.300 poin), 10 badge kriteria JSONB; `api/README.md` ditulis ulang: kontrak endpoint penuh + alur token + rate limit + seed |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Endpoint baru**: `POST /v1/auth/register` (201 + pasangan token; 409 email duplikat),
  `POST /v1/auth/refresh` (rotasi access+refresh; menolak access token/akun nonaktif),
  `POST /v1/auth/google`, `GET/PATCH /v1/profile`, `POST /v1/profile/avatar`,
  mount statis `/uploads`.
- **Refresh token stateless**: JWT `type=refresh` dgn `jti` + claim `rem` (dipertahankan
  saat rotasi agar umur sesi konsisten). Pembatalan akses = `users.is_active=false`.
  Access token default dipangkas 1440 → 60 menit (konsekuensi logis adanya refresh).
- **Rate limit login**: Redis `INCR`+`EXPIRE` per `email+IP` (X-Forwarded-For hop pertama),
  5 gagal/15 menit → 429 dgn sisa menit; sukses menghapus hitungan; **fail-open** bila
  Redis tidak tersedia (warning log) — hardening global tetap di Sprint 8.
- **Google Sign-In (server)**: verifikasi ID token via endpoint `tokeninfo` Google
  (aud vs `GOOGLE_CLIENT_ID`, iss, exp, email_verified), upsert user, dan **penautan
  otomatis** ke akun email+password yang sudah ada. Migrasi `b7c4d9e1a2f3` menambah
  `users.google_sub` (unique, nullable).
- **Audit**: middleware generik kini melewatkan seluruh `/v1/auth/*`; register/login/google
  diaudit eksplisit (termasuk percobaan yang diblokir rate limit, `reason: rate_limited`).
- **Test**: 15 → **51 test** (register 4, refresh 5, rate limit 4, google 9, profil 8,
  seed 4 + existing). Conftest kini juga `flushdb` Redis antar test.
- **Dependensi baru**: `httpx` (tokeninfo Google), `python-multipart` (upload).

### 3.2 Mobile (`mobile/`)

- **Alur & guard router**: `/onboarding` → `/auth` → `/` & `/profil` (requiresAuth);
  pengguna terautentikasi tidak melihat auth/onboarding lagi; pemulihan sesi dari
  localStorage via `/v1/profile`.
- **AuthView** (mockup `auth.html`): tab Masuk/Daftar, validasi per-field, toggle kata
  sandi, "Ingat saya", checkbox Syarat & Ketentuan, error box utk 401/409/429/jaringan,
  spinner pada tombol saat memproses.
- **api client + auth store**: wrapper fetch dgn auto-refresh sekali pada 401 (single-flight),
  `ApiError` ternormalisasi; sesi access+refresh di localStorage.
- **ProfileView**: kartu profil (avatar inisial/foto, chip level), statistik poin/kota/level,
  ubah nama & kota, unggah avatar (validasi tipe & ukuran di klien + server), keluar dgn
  confirm; state skeleton/error/retry.
- **HomeView**: sapaan "Assalamu'alaikum, {nama depan}", avatar → profil, pill level dari
  server, empty state via `StateEmpty`; nav bawah + FAB diekstrak ke `BottomNav` bersama.
- **Google Sign-In (klien)**: adapter `services/googleAuth.ts` — memberi pesan mikro yang
  jelas saat belum dikonfigurasi; branch native didokumentasikan (lihat §5).

### 3.3 Admin (`admin/`)

- Ikut menikah dgn skema token baru: store menyimpan refresh token, `client.ts` melakukan
  auto-refresh sekali pada 401 dan logout otomatis saat refresh ditolak — diperlukan karena
  umur access token dipangkas ke 60 menit. Terverifikasi browser: login → dashboard shell.

### 3.4 Dokumentasi & konfigurasi

- `api/README.md`: kontrak endpoint lengkap, alur token, rate limit, seed, env baru
  (`REFRESH_TOKEN_EXPIRE_DAYS`, `LOGIN_MAX_ATTEMPTS`, `GOOGLE_CLIENT_ID`, `UPLOAD_DIR`, …).
- `mobile/README.md` + `.env.example`: `VITE_API_URL` (IP LAN utk uji perangkat),
  `VITE_GOOGLE_CLIENT_ID`; `Makefile` target baru `api-seed`; `.gitignore` `api/var/`.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest` | ✅ 51 lulus (DB & Redis test nyata via compose) |
| ruff + eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses |
| Seed idempoten | `scripts.seed` dijalankan 2× | ✅ 7/10/10 baris, tidak duplikat (+4 test) |
| Register → beranda | Browser (390×844): daftar "Aisyah Putri" | ✅ auto-login, beranda menyapa nama + level |
| Error state input salah | Browser: form kosong; kredensial salah | ✅ pesan per-field + error box merah (screenshot) |
| Profil + persistensi | Browser: ubah kota → Bandung; reload | ✅ tersimpan; sesi dipulihkan setelah reload |
| Keluar | Browser: tombol Keluar → confirm | ✅ kembali ke `/auth`, sesi dibuang |
| Refresh token | curl + test: refresh → pasangan baru; access ditolak sbg refresh | ✅ |
| Rate limit | Test: 5 gagal → 429 (juga dgn sandi benar); sukses reset; per-email terisolasi | ✅ |
| Admin login (kompatibilitas) | Browser: login admin baru → dashboard | ✅ dgn bentuk token baru; error 401 tampil utk sandi salah |
| Smoke endpoint nyata | curl: register/login/profil/patch/avatar/refresh/google(503 sesuai desain) | ✅ |
| APK debug | `./gradlew assembleDebug` | ✅ 5,5 MB; CI juga memproduksinya |
| Perangkat Android nyata | — | ⚠️ Belum (tidak ada perangkat terhubung); APK + `adb install` siap |

---

## 5. Keputusan & Catatan Teknis

1. **Google Sign-In native ditunda sebagian** (satu-satunya story tidak 100%): tidak ada
   plugin komunitas yang kompatibel Capacitor 8 (`@codetrix-studio/capacitor-google-auth`
   3.4.0-rc.4 peer `@capacitor/core ^6`) dan OAuth Client ID belum ada (prasyarat akun GCP,
   plan §2.2 — item yang sama yang sudah terbuka sejak Sprint 0). Yang bisa dibangun tanpa
   keduanya sudah selesai: endpoint server teruji penuh (9 test, verifikasi di-mock),
   skema `google_sub`, penautan akun, tombol + microcopy di UI. **Sisa kerja**: pasang
   plugin + kirim ID token ke `/v1/auth/google` begitu client id terbit — est. ≤1 poin,
   diusulkan masuk backlog Sprint 2+ (tidak memblokir Sprint 2: Scan AI).
2. **Access token 1440 → 60 menit**: konsekuensi adanya refresh. Admin panel ikut diberi
   auto-refresh agar sesi tidak terputus di tengah kerja.
3. **Refresh stateless**: rotasi token tanpa whitelist server; trade-off (token lama
   berlaku sampai exp) dicatat di README — penerimaan utk MVP, hardening menyusul.
4. **Rate limit fail-open** saat Redis mati: ketersediaan login diutamakan; dicatat
   eksplisit di kode & README, revisi di Sprint 8 (hardening).
5. **Avatar disimpan di `api/var/uploads`** dan dilayani statis; di produksi direktori ini
   harus di-volume-kan (catatan di `.env.example` & README). Validasi pakai magic bytes,
   bukan sekadar Content-Type header.
6. **Kata sandi admin lama lokal tidak diketahui** (dibuat di Sprint 0 dgn env khusus) —
   dibuat akun admin baru via `scripts.create_admin` utk verifikasi; bukan bug.

---

## 6. DoD Sprint 1 — Checklist

- [x] CI hijau (lokal setara CI; push `ba1f57c` memicu run GitHub).
- [x] Unit test logika baru (rate limit, refresh, verifikasi Google, seed, profil); 51
      test total. *Pengukuran coverage % masih menyusul Sprint 2 sesuai catatan Sprint 0.*
- [x] UI 100% dari `tokens.css` — gaya baru di `app.css` memakai token (nol hardcode);
      struktur kelas disalin dari mockup auth/onboarding.
- [x] State lengkap: loading (skeleton), empty (beranda), error (auth box, StateError +
      retry), offline-bar (event online/offline), toast.
- [x] Aksesibilitas: tap target ≥44px, label + `aria-invalid`/`role=alert` pada form,
      `aria-selected` pada tab/dots, ikon `aria-hidden`, `sr-only` utk input file.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata — **belum** (tidak ada perangkat terhubung);
      APK debug siap + instruksi di `mobile/README.md`. Chrome (via WebView IAB) lolos.
- [x] Terdokumentasi: `api/README.md` (kontrak penuh), `mobile/README.md` (env, alur,
      struktur), `.env.example` api & mobile.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Hosting (plan §2.1 #5)** | Tetap terbuka dari Sprint 0 — staging dibutuhkan mulai Sprint 2 (uji LLM asli) | **Sebelum Sprint 2** |
| 2 | Scope & budget LLM (§2.1 #1–2) | Rate limit scan/hari bergantung ini | Sebelum Sprint 2 |
| 3 | OAuth Client ID Google (GCP) | Menuntaskan sisa story Google Sign-In (native wiring) | Fleksibel; kapan pun sebelum rilis |
| 4 | Perangkat Android utk uji lapangan | Demo Sprint 3 (scan kamera) wajib di perangkat | Sebelum Sprint 3 |

---

## 8. Yang Menyusul (Sprint 2 — Scan AI: Backend)

`POST /scan` end-to-end: upload → LLM (mock mode utk dev) → JSON tervalidasi → tersimpan;
prompt engineering + Pydantic schema; cache Redis per item; rate limit scan/user/hari;
point ledger service (append-only). Keputusan §2.1 #1–2 (scope respons & budget LLM)
wajib sudah ditutup.
