# Release Notes — Ekoteologi AR v1.0.0 (internal testing)

> Target distribusi: **Play Console → Testing → Internal testing** (Sprint 8,
> goal plan: "MVP rilis ke internal testing Play Store").
> Aplikasi: `id.ekoteologi.app` · versionCode 1 · versionName 1.0.0
> (keduanya env-overridable via `EKO_VERSION_CODE`/`EKO_VERSION_NAME`).

---

## Ringkasan rilis (untuk tester internal)

Ekoteologi AR adalah pendamping ibadah & ekologi: scan sampah dengan bantuan
AI, klaim misi lingkungan dengan verifikasi foto, kumpulkan poin & streak,
lengkapi lencana, dan belajar modul ekoteologi dengan kuis.

### Yang bisa diuji di build ini

- **Scan AI** — foto sampah dianalisis menjadi kategori + poin; hasil <2 detik
  bila foto pernah dianalisis (cache). Kuota harian 20 scan/user.
- **Misi** — klaim misi photo (unggah bukti + consent), manual, dan auto_scan;
  loop verifikasi admin dengan notifikasi hasil (disetujui/ditolak + alasan).
- **Gamifikasi** — poin via ledger, level, streak harian (+bonus kelipatan),
  lencana otomatis, leaderboard (backend).
- **E-Learning** — modul + pelajaran + kuis (lulus ≥70% → +20 poin sekali per
  modul) dan konten harian (ayat/hadis/refleksi terjadwal).
- **Notifikasi** (baru Sprint 8) — push FCM: hasil verifikasi misi, misi
  baru, streak reminder ("jaga streak N hari-mu"), dan pengumuman admin
  (composer push semua/segmen). Mode kredensial belum dipasang → pesan hanya
  tampil di log server dan notifikasi in-app.
- **Hardening** (baru Sprint 8) — rate limit global, security header, Sentry
  opsional (tidak aktif tanpa DSN), metrik event lengkap.

### Batas yang diketahui (jujur untuk tester)

- Google Sign-In: tombol tampil tetapi **belum aktif** (menunggu OAuth Client
  ID — item terbuka). Gunakan email + kata sandi.
- Analisis AI mode **mock** bila server staging belum memasang `LLM_API_KEY`.
- Push FCM butuh `PUSH_MODE=fcm` + service account; tanpa itu push hanya log.
- Bahasa: Indonesia saja. Reward fisik, komunitas, peta: Fase 2.

## Isi teknis v1.0.0 (Sprint 8)

- Notif event: misi approve (ada sejak Sprint 5, kini ter-pipe FCM), misi
  baru (broadcast saat admin membuat misi), streak reminder (scheduler
  in-process idempoten per hari + trigger admin).
- Composer push admin (`/push`): semua/segmen (semua, aktif 7 hari, pasif
  >7 hari, bertoken) + audit log rekap.
- Hardening: rate limit global per IP (`GLOBAL_RATE_LIMIT_PER_MINUTE`),
  security header (nosniff, frame-deny, referrer, CSP, permissions-policy,
  HSTS di prod), Sentry env-gated, `GET /v1/admin/metrics/events`.
- Android: izin `CAMERA` + `POST_NOTIFICATIONS` + uses-feature non-wajib,
  signing release via env (`EKO_STORE_FILE` dkk.), versi via env.
- QA: smoke E2E 20+ langkah lintas alur kritis, regresi penuh pytest/vitest,
  dokumen device matrix utk QA manual.

## Catatan upgrade

- versionCode mulai dari 1 — belum ada upgrade path (rilis internal pertama).
- Server wajib sudah menjalankan migrasi hingga `head` (tanpa migrasi baru di
  Sprint 8 — skema penuh sejak Sprint 0 terbayar lagi).
