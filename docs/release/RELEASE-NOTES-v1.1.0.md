# Release Notes — Ekoteologi AR v1.1.0 (internal testing)

> Target distribusi: **Play Console → Testing → Internal testing** (Sprint 13,
> goal plan: "MVP berjalan penuh di PocketBase dan rilis ulang ke internal
> testing"). Aplikasi: `id.ekoteologi.app` · versionCode 2 · versionName
> 1.1.0 (env-overridable via `EKO_VERSION_CODE`/`EKO_VERSION_NAME`).
>
> **Rilis penutup migrasi backend FastAPI → PocketBase** (Sprint 9–13;
> riwayat migrasi: `docs/sprint/sprint-9.md` … `sprint-13.md`).

---

## Ringkasan rilis (untuk tester internal)

Pembaruan terbesar: **seluruh logika bisnis kini berjalan di server
PocketBase** — kuis dinilai server, notifikasi hidup realtime, dan push FCM
aktif. Isi tester perhatikan:

### Baru di v1.1.0

- **E-Learning dinilai server** — kuis tidak bisa "dibaca kuncinya" lagi:
  jawaban dikirim ke server, hasil + poin diputuskan server, dan poin kuis
  (+20) hanya masuk **sekali per modul** (mengulang kuis yang sudah lulus
  tidak memberi poin lagi). Progres pelajaran berurutan juga dihitung server —
  aman dilanjutkan antar perangkat.
- **Notifikasi realtime** — hasil verifikasi misi, bonus streak, pengingat
  streak, lencana baru, dan pengumuman admin muncul **seketika tanpa tarik
  ulang** (SSE), plus notifikasi in-app seperti sebelumnya.
- **Push FCM** — notifikasi di atas juga dikirim ke perangkat (FCM HTTP v1).
  Bila kredensial server belum dipasang, pesan tetap tampil in-app + realtime
  dan hanya dicatat di log server (mode aman).
- **Composer push admin** — pengumuman admin (semua pengguna / segmen aktif
  7 hari / pasif > 7 hari / pemilik token) kini benar-benar terkirim, lengkap
  rekap penerima-perangkat-terkirim dan catatan audit.
- **Konten harian selalu ada** — kartu kutipan harian diterbitkan otomatis
  dari bank terkurasi tiap tengah malam bila admin belum menjadwalkan.
- **Hardening & ops** — backup otomatis database (retensi 7 arsip + cadangan
  manual oleh admin), pembersihan data sementara kedaluwarsa, error tak
  terduga terkirim ke Sentry (bila DSN aktif), dan dashboard admin kini
  menampilkan scan, cache hit rate, estimasi biaya LLM, dan dua chart.

### Perbaikan penting

- Verifikasi misi kini **atomik**: kegagalan di tengah proses tidak lagi
  mungkin meninggalkan klaim "disetujui" tanpa poin (atau sebaliknya).
- Kunci jawaban kuis tidak pernah dikirim ke aplikasi (sebelumnya kuis dinilai
  di klien).
- Notifikasi tidak bisa diubah isinya oleh pemiliknya (hanya tandai dibaca).
- Token push perangkat yang mati otomatis dibersihkan dari server.

### Batas yang diketahui (jujur untuk tester)

- Push FCM **perlu kredensial Firebase di server** (item terbuka — lihat
  checklist rilis); tanpa itu notifikasi tetap hidup in-app + realtime.
- Google Sign-In masih menunggu OAuth Client ID (item terbuka sejak Sprint 1);
  gunakan email + kata sandi.
- Analisis AI tetap mode **mock** bila server staging belum mengarah ke 9Router.
- Reward fisik, komunitas, peta: Fase 2.

## Isi teknis v1.1.0 (Sprint 13)

- Backend PocketBase v0.40.3 (pin) + hook JSVM: 6 route e-learning
  (`/api/ekoteologi/modules|lessons|.../quiz`), `daily-content`, composer push
  (`/api/ekoteologi/admin/push/*`), dashboard agregasi
  (`/api/ekoteologi/admin/dashboard`), cron/cleanup/backup routes.
- Koleksi terkunci dari tulis/baca klien sesuai kebutuhan: `quizzes` +
  `quiz_questions` (baca: staff), `user_quiz_attempts`, `user_module_progress`.
- Pipeline notifikasi→push (hook `onRecordAfterCreateSuccess`): segmen,
  rekap `payload.push`, auto-hapus token mati (FCM 404/410).
- FCM OAuth RS256 murni JSVM (SHA-256 + RSA PKCS#1 v1.5 via BigInt goja);
  access token di-cache (L1 store + L2 `app_settings`).
- Review klaim full-atomik (satu transaksi; rollback teruji dgn instance
  fault-injection), anti-pembajakan kepemilikan klaim.
- Cron baru: auto-publish konten harian, cleanup `app_settings`/`llm_cache`,
  backup bawaan PB (env `BACKUP_*`).
- Middleware error → Sentry (`SENTRY_DSN`) + PB logs.
- Mobile: swap e-learning/konten harian ke route hook + subscribe realtime
  (`pb.collection('notifications').subscribe`) di beranda.
- Admin: dashboard & composer push tersambung route agregasi/broadcast.
- QA: pb-test 254 asersi (termasuk FCM mock: JWT RS256 diverifikasi crypto
  Node; rollback; fallback log), E2E SDK 51 asersi (termasuk realtime SSE),
  smoke; lint/test/build admin & mobile hijau; APK debug sukses.

## Catatan upgrade (dari v1.0.0)

- Server: jalankan PocketBase v0.40.3 dengan `pb_migrations`+`pb_hooks` baru —
  migrasi `1757700000_sprint13_bootstrap.js` berjalan otomatis (mengunci
  koleksi kuis/progres + menyalakan backup bawaan PB dari env `BACKUP_*`).
- Env baru (lihat `pocketbase/.env.example`): `PUSH_MODE`,
  `FCM_CREDENTIALS_FILE`/`FCM_CREDENTIALS_JSON`, `FCM_PROJECT_ID`,
  `QUIZ_PASS_PERCENT`, `QUIZ_POINTS`, `DAILY_CONTENT_*`, `BACKUP_*`,
  `CLEANUP_CRON`, `SENTRY_DSN`, `LLM_COST_PER_1K_TOKENS`.
- Android: versionCode naik 1 → 2; tidak ada izin baru.
- Rollback aplikasi ke 1.0.0 aman terhadap server baru (klien lama tetap
  memakai API koleksi untuk e-learning; kuis lama dinilai klien — tidak
  direkomendasikan, hanya untuk darurat).
