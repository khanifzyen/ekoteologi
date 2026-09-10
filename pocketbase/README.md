# PocketBase — Backend Ekoteologi AR

Backend sejak **Sprint 9** (migrasi dari FastAPI — riwayat di tag git
[`fastapi-archive`](../../)). Satu binary PocketBase + ekstensi JS:

| Direktori | Isi |
|---|---|
| `pb_migrations/` | Skema koleksi + seed (JS, jalan otomatis saat `serve`) |
| `pb_hooks/` | Route kustom & guard hook (JSVM — tanpa API Node/npm) |
| `scripts/` | `test.mjs` (verifikasi skema+rules), `e2e-sdk.mjs` (alur klien SDK), `smoke.mjs` (health) |
| `pb_data/` | SQLite + storage (di-gitignore, di-volume-kan saat deploy) |
| `pocketbase` | Binary v**0.40.3** (di-pin — keputusan M1; di-gitignore; `make pb-install`) |

## Mulai cepat

```bash
make pb-install      # unduh binary v0.40.3 (sekali)
make pb-superuser    # buat superuser dari env PB_SUPERUSER_*
make pb-serve        # serve di http://127.0.0.1:8090 (dashboard /_/)
make pb-test         # verifikasi skema + seed + rules (instance uji sekali pakai)
make pb-smoke        # smoke health + ping
```

Konfigurasi via env saja — lihat `.env.example`. Superuser: `PB_SUPERUSER_EMAIL`/
`PB_SUPERUSER_PASSWORD` (dipakai `pocketbase superuser upsert` — PB v0.40 tidak
lagi membuat superuser otomatis dari env saat `serve`).

## Kontrak API

### Endpoint bawaan PocketBase

CRUD koleksi: `/api/collections/{koleksi}/records`, auth: `/api/collections/users/
auth-with-password`, file: `/api/files/{koleksi}/{id}/{filename}`, realtime SSE:
`/api/realtime`, health: `/api/health`. Klien memakai SDK `pocketbase`
(sprint 10 — swap SDK admin & mobile).

### Route kustom (`pb_hooks`)

| Route | Auth | Keterangan |
|---|---|---|
| `GET /api/ekoteologi/ping` | publik | name/version/time — dipakai smoke CI |
| `POST /api/ekoteologi/scan` | user | **Scan AI (sprint 11)** — multipart `image` (JPG/PNG/WebP, maks `SCAN_IMAGE_MAX_MB` default 5 MB) → LLM (mock/live 9Router) → JSON tervalidasi `{item_name, category, advice, quote, points}` → tersimpan + poin via ledger. Respons: `{id, item_name, category, advice, quote, points, points_total, cached, duplicate, image, created_at}`. Foto byte-identikal dari user sama di hari sama → `duplicate=true`, poin 0 (anti poin-farming). Kuota habis → 429 + header `Retry-After` + body `retry_after`. LLM gagal total → 502. |
| `GET /api/ekoteologi/scan/quota` | user | `{used, limit, remaining, resets_in_seconds}` — penghitung harian server-side (`scan_quota:{uid}:{tanggal}` di `app_settings`; env `SCAN_DAILY_LIMIT` default 20) |
| `GET /api/ekoteologi/scan/stats` | user | `{hit, miss, total, hit_rate, llm_mode}` — statistik cache (target hit rate ≥70% — PRD §5.10 #6) |
| `POST /api/ekoteologi/missions/{id}/claim` | user | **Klaim misi (sprint 12)** — `photo`: multipart `proof` (JPG/PNG/WebP, maks `MISSION_IMAGE_MAX_MB` default 5 MB) + `consent=1` (wajib, PRD §9) + `note` opsional → antrian `submitted`; `manual`: JSON kosong → **auto-approve** + poin langsung; `auto_scan` → 400 (progres dari scan). Periode dihitung server (daily/special = hari ini; weekly = Senin; jendela `start_at`–`end_at` divalidasi). Anti dobel: pre-check + unique index `(user, mission, period_date)` → 409 ramah; klaim `rejected` boleh diklaim ulang (baris sama dipakai ulang). Respons: `{claim: {id, status, progress_count, points_awarded, review_note, submitted_at}, message, points_total}` |
| `GET /api/ekoteologi/badges` | user | Daftar lencana + flag `earned` — dengan **lazy badge sync** (kriteria JSON dievaluasi idempoten dulu — paritas `GET /v1/badges` FastAPI) |
| `GET /api/ekoteologi/streak` | user | `{current_streak, longest_streak, active_today, last_active_date, bonus_points, bonus_every_days, days_to_bonus, week:[{date,active}]}` — streak efektif + kalender 7 hari dari ledger |
| `POST /api/ekoteologi/cron/streak-reminder` | admin | Trigger manual pass reminder streak (idempoten per hari) → `{sent}`; versi terjadwal hidup di `cronAdd` (env `STREAK_REMINDER_CRON`) |

Route sprint 13 (e-learning, notifikasi & ops):

| Route | Auth | Keterangan |
|---|---|---|
| `GET /api/ekoteologi/modules` | user | Daftar modul tayang + progres saya + ringkasan `{completed,total}` + CTA kartu (Mulai/Lanjutkan/Ulangi diturunkan server) |
| `GET /api/ekoteologi/modules/{id}` | user | Detail modul: pelajaran urut + intro kuis **tanpa kunci jawaban** + hasil kuis terbaik saya |
| `GET /api/ekoteologi/lessons/{id}` | user | Satu pelajaran (blok JSON paragraph/quote/tip) + `next_lesson_id` |
| `POST /api/ekoteologi/lessons/{id}/complete` | user | Progres berurutan (`lessons_done = max(tercatat, order+1)`); pelajaran terakhir → event `modul_selesai` + streak + badge (transisi sekali) |
| `GET /api/ekoteologi/modules/{id}/quiz` | user | Intro kuis: soal tanpa kunci; `QUIZ_PASS_PERCENT` (70) & `QUIZ_POINTS` (20) via env |
| `POST /api/ekoteologi/modules/{id}/quiz` | user | **Penilaian server-side** — lulus → attempt + poin SEKALI per modul via ledger (anti dobel; `already_passed_before` pada lulus ulang) + notifikasi + event + streak + badge, satu transaksi; gagal → attempt tersimpan tanpa poin; respons memuat review (kunci + penjelasan) |
| `GET /api/ekoteologi/daily-content` | user | Konten hari ini (terjadwal admin) atau fallback rotasi bank quote terkurasi — selalu 200 dgn flag `fallback` |
| `POST /api/ekoteologi/cron/daily-content` | admin | Trigger auto-publish konten harian dari bank (idempoten; cron `DAILY_CONTENT_CRON`, matikan via `DAILY_CONTENT_AUTOPUBLISH=0`) |
| `GET /api/ekoteologi/admin/push/segments` | admin | Rekap penerima + token per segmen (preview komposer) |
| `POST /api/ekoteologi/admin/push/broadcast` | admin | Composer push semua/segmen — validasi judul 4–64 & isi 8–300; SATU baris broadcast `user=""` + push best-effort + rekap `{recipients,tokens,sent}` + audit |
| `GET /api/ekoteologi/admin/dashboard` | staff | Agregasi KPI + chart (pengguna, scan, antrian verifikasi, cache hit rate, token/biaya LLM bulan berjalan, scan harian 14 hari, kategori 7 hari) |
| `POST /api/ekoteologi/cron/cleanup` | admin | Pembersihan kunci `app_settings` kedaluwarsa (`sr:*`, `scan_quota:*`, `sd:*`, guard login lewat jendela, cache token FCM) + `llm_cache` kadaluarsa → `{settings_removed, cache_removed}`; cron `CLEANUP_CRON` (default 03.30) |
| `POST /api/ekoteologi/cron/backup` | admin | Cadangan `pb_data` on demand (`$app.createBackup`) — jadwal otomatis memakai fitur bawaan PB (env `BACKUP_ENABLED`/`BACKUP_CRON`/`BACKUP_KEEP`), arsip di `/api/backups` |

Hook sprint 10 (auth, profil & audit — pengganti middleware FastAPI):

- **Audit log** — setiap create/update/delete koleksi bisnis + login sukses
  (dan percobaan masuk yang diblokir) tercatat di `audit_logs` (tulis konteks
  sistem, baca admin) via `onRecord{Create,Update,Delete}Request` +
  `onRecordAuthRequest`. Field sensitif (`password`, `tokenKey`) tidak
  pernah ikut dalam `diff`. Aksi `POST /api/ekoteologi/scan` tercatat sbg
  `action=scan` (pembuatan record via konteks internal tidak memicu hook
  request, jadi route menulis baris auditnya sendiri).
- **Guard login per-identitas** — 10 percobaan / 15 menit / email (login
  sukses mereset), hitungan di `app_settings` (`login_guard:{email}`); blokir
  = 429 berbahasa Indonesia + audit `login_failed rate_limited`.

Hook sprint 11 (scan & ledger — `pb_hooks/scan.pb.js`):

- **Adapter LLM di JSVM** — `LLM_MODE=mock` (default dev/test): item
  deterministik dari digest foto → hasil sama = cache teruji end-to-end.
  `LLM_MODE=live`: `$http.send` → **9Router** self-hosted
  (`LLM_BASE_URL=http://127.0.0.1:20128/v1`, OpenAI-compatible, tanpa API key)
  dengan `LLM_MODEL` + `LLM_FALLBACK_MODEL`, retry per model
  (`LLM_MAX_RETRIES`, backoff via `sleep()`), timeout (`LLM_TIMEOUT_SECONDS`),
  parsing toleran (respons 9Router bisa berakhiran `data: [DONE]`), dan
  validasi ketat hasil LLM (schema + kategori harus ada di
  `waste_categories`; gagal = percobaan ulang/fallback, tak pernah ke DB).
  Quote LLM SELALU diganti bank quote terkurasi per kategori (anti-halusinasi,
  PRD §9). Aplikasi klien tidak pernah memanggil LLM langsung.
- **Cache `llm_cache`** (pengganti Redis) — L1 `$app.store()` (in-memory
  lintas executor, string JSON + TTL) + L2 koleksi `llm_cache`
  (`key = "scan:"+sha256(base64(foto))`, `value`, `expires`;
  `SCAN_CACHE_TTL_HOURS` default 24). Hit/miss dicatat di `app_settings`
  (`scan_cache_stats`) untuk metrik hit rate.
- **Kuota harian & duplikat** — counter `scan_quota:{uid}:{tanggal}` dan
  fingerprint `sd:{uid}:{tanggal}` (daftar prefix digest) di `app_settings`,
  fail-closed (DB tak dapat dihubungi → 503).
- **Ledger `point_transactions`** (PRD §5.10 #1) — hook MODEL-level:
  create divalidasi (`amount` bulat > 0, user ada) lalu `users.points`
  disinkronkan dalam transaksi yang sama (scan→poin atomik via
  `runInTransaction`; dipakai ulang sprint 12 untuk klaim/verifikasi).
  UPDATE/DELETE ledger ditolak total (append-only; rekonsiliasi = baris baru).
  Koleksi terkunci dari API publik (default deny).
  **Level engine (sprint 12)**: hook yang sama menghitung ulang
  `users.level`/`level_title` dari tangga `levels.min_points` setiap poin
  berubah (cache posisi — sumber kebenaran tetap koleksi `levels`).

Hook sprint 12 (misi, verifikasi & gamifikasi — `pb_hooks/gamification.pb.js`):

- **Engine review klaim** — PATCH `user_missions` hanya untuk staff
  (verifier/admin; updateRule + guard hook): keputusan `submitted → approved`
  otomatis memberi poin misi lewat ledger (`points_awarded` & `reviewed_by/at`
  dipaksa server — klien tak bisa menetapkan poin), notifikasi in-app, event
  `misi_selesai`, streak berdetak, dan badge on-event; `submitted → rejected`
  mewajibkan `review_note` dan menotifikasi user. Review ulang ditolak (409).
- **Progres auto_scan** — hook create `scans`: hanya scan bernilai poin (bukan
  duplikat) yang memajukan misi `auto_scan` aktif sesuai `scan_category`
  (kosong = semua kategori); target `required_count` tercapai → klaim
  auto-approve + poin ledger + notifikasi + event (satu transaksi dgn scan).
- **Streak harian** — reset lazy (bolong → kembali ke 1 saat aktif lagi;
  tampilan efektif 0), bonus ledger `source=streak` setiap kelipatan
  `STREAK_BONUS_EVERY_DAYS` (default 6) sebesar `STREAK_BONUS_POINTS`
  (default 20; 0 = mati) + notifikasi + event `streak_hari`; idempoten per
  hari. Memicu: scan bernilai poin, klaim manual, dan approve misi.
- **Badge engine** — kriteria JSON `{"type","value"}` (scan_count,
  mission_done, streak rekor, points_earned, quiz_passed) dievaluasi on-event
  (scan bernilai, approve/klaim manual) + lazy di `GET /api/ekoteologi/badges`;
  penulisan `user_badges` idempoten (unique index) + notifikasi per lencana
  baru; kriteria korup/tidak dikenal = tidak diraih (fail-closed).
- **Cron reminder streak** — `cronAdd` (env `STREAK_REMINDER_CRON`, default
  `0 8 * * *`) menulis notifikasi in-app utk user aktif kemarin yang belum
  aktif hari ini (idempoten per hari via guard `app_settings`); pengiriman
  Push FCM + realtime mengalir otomatis via pipeline notifikasi (sprint 13,
  push.pb.js). Trigger manual: route admin.
- **Proteksi hapus misi** — DELETE `missions` dengan klaim → 409
  (nonaktifkan saja — jaga riwayat; paritas admin_missions.py FastAPI).

Hook sprint 13 (e-learning, notifikasi & ops):

- **Kuis & progres terkunci server-side** — koleksi `quiz_questions`/
  `quizzes` tertutup dari baca publik (kunci jawaban hanya keluar lewat route,
  sesudah submit); `user_quiz_attempts` & `user_module_progress` tanpa rule
  tulis (attempt `passed=true` palsu tidak bisa memanen lencana; progres tidak
  bisa dipalsukan — paritas scans sprint 11 & user_missions sprint 12).
- **Pipeline notifikasi → push (realtime + FCM)** — setiap baris
  `notifications` yang lahir (verifikasi misi, bonus streak, reminder cron,
  lencana, poin kuis, misi baru, broadcast) otomatis di-push via hook
  `onRecordAfterCreateSuccess`: user terisi → token miliknya; user kosong →
  token sesuai segmen `payload.segment` (all / aktif_7hari / pasif_7hari /
  bertoken). Rekap `{recipients,tokens,sent,mode}` ditulis kembali ke
  `payload.push`; token yang ditolak FCM (404/410) dihapus. Realtime in-app
  memakai SSE bawaan PB (`/api/realtime`, SDK subscribe — teruji E2E).
- **FCM HTTP v1 di JSVM** — `PUSH_MODE=fcm`: JWT **RS256** service account
  dibuat murni di JSVM (SHA-256 + RSA PKCS#1 v1.5 via BigInt goja —
  `$security` hanya punya HS256/HS512), ditukar access token (cache
  `$app.store()` + `app_settings`), lalu POST `messages:send`. Tanpa
  kredensial layak → fallback log (fail-safe, teruji). Env:
  `FCM_CREDENTIALS_FILE`/`FCM_CREDENTIALS_JSON`, `FCM_PROJECT_ID`,
  `FCM_OAUTH_URL`/`FCM_SEND_URL` (override uji).
- **Event "misi baru"** — misi aktif yang diterbitkan admin memicu broadcast
  `Misi baru!` (paritas `announce_new_mission` FastAPI).
- **Guard `notifications`** — pemilik hanya boleh mengubah `read_at` (judul/
  isi tidak bisa dideface); superuser bebas.
- **Review klaim full atomik** — PATCH `user_missions` (staff) menjalankan
  save + ledger + notifikasi + event + streak + badge + audit dalam SATU
  transaksi; gagal di tengah = tidak ada yang berubah (klaim tetap
  `submitted`, poin tidak bergerak — menutup temuan sprint 12 §4 #5).
  Pemilik/misi klaim dipaksa dari nilai asli (anti pembajakan klaim).
- **Dashboard agregasi** — `GET /api/ekoteologi/admin/dashboard`: SQL
  `$app.db().newQuery().all()` terbukti gagal di JSVM v0.40 ("Invalid
  variable type: must be a pointer" — diverifikasi ulang), agregasi memakai
  `findRecordsByFilter` + hitung di JS (skala MVP; diamati ke depan).
- **Error hook** — middleware `routerUse` menangkap error tak terduga route
  (tanpa status / ≥500; bisnis 4xx tidak) → Sentry (`SENTRY_DSN`, store
  endpoint) + PB logs; cron memakai reporter yang sama.
- **Backup & cleanup** — backup otomatis = fitur bawaan PB (migrasi sprint 13
  mengisi `settings.backups.cron` dari env) + route manual; cleanup cron
  membuang kunci `app_settings` kedaluwarsa & `llm_cache` kadaluarsa.

### Koleksi (port `api/app/models/*` — PRD §5)

29 koleksi. Pemetaan: `UUID/BIGSERIAL PK → id PB (autoid)`,
`TIMESTAMPTZ created_at → created (autodate sistem)`, `JSONB → json`,
`UNIQUE(...) → unique index`, `REFERENCES → relation`, `*_url gambar → field file`
(avatar, image, proof; di-upload multipart di sprint 10–12), `google_sub` →
koleksi sistem `_authOrigins` (OAuth2 Google bawaan, sprint 10).

| Koleksi | Sumber | Baca | Tulis |
|---|---|---|---|
| `users` (auth) | users | user ter-auth (leaderboard) | daftar publik terbatas role `user`; update diri sendiri / admin |
| `fcm_tokens` | fcm_tokens | pemilik | pemilik |
| `levels` | levels | publik | admin |
| `point_transactions` | point_transactions | pemilik / admin | **terkunci** — hook ledger (sprint 11), append-only |
| `badges` | badges | publik | admin |
| `user_badges` | user_badges | pemilik / admin | terkunci — badge engine (sprint 12) |
| `waste_categories` | waste_categories | publik | admin |
| `scans` | scans | pemilik | tulis via route scan (sprint 11); immutable bagi klien |
| `missions` | missions | publik (aktif); admin semua | admin (admin/editor); hapus ditolak bila ada klaim |
| `user_missions` | user_missions | pemilik + staff (verifier/editor/admin) | tulis via route klaim (sprint 12); review staff — engine hook |
| `user_badges` | user_badges | pemilik / admin | terkunci — badge engine (sprint 12) ✅ |
| `modules` | modules | publik (terbit); admin semua | admin + editor |
| `lessons` | lessons | modul terbit | admin + editor |
| `quizzes`, `quiz_questions` | quizzes, quiz_questions | modul terbit | admin + editor |
| `user_module_progress` | user_module_progress | pemilik | terkunci — route `lessons/{id}/complete` (sprint 13) |
| `user_quiz_attempts` | user_quiz_attempts | pemilik | terkunci — hook penilaian kuis (sprint 13); append-only |
| `quizzes`, `quiz_questions` | quizzes, quiz_questions | admin + editor saja (kunci jawaban tidak pernah publik — sprint 13) | admin + editor |
| `daily_contents` | daily_contents | publik (publish_date lewat / hari ini) | admin + editor |
| `posts`, `post_likes`, `post_comments` [fase 2] | community.py | publik (non-hidden, tak terhapus); like publik | pemilik; soft delete |
| `reports` | community.py | admin | create user (reporter = diri) |
| `map_locations` | community.py | publik | admin |
| `rewards` [fase 2] | reward.py | publik (aktif) | admin |
| `redemptions` [fase 2] | reward.py | pemilik / admin | create pemilik; update admin |
| `notifications` | system.py | pemilik + broadcast (user kosong) | terkunci — hook event (sprint 13); update `read_at` saja oleh pemilik (guard) |
| `audit_logs` | system.py | admin | terkunci — hook (sprint 10) |
| `analytics_events` | system.py | admin | terkunci — konteks sistem |
| `app_settings` | system.py | terkunci (superuser) | terkunci |
| `llm_cache` (cache scan — sprint 11) | — | terkunci | terkunci — hook scan |

**Prinsip rules** (pengganti `core/deps.require_roles`):

- **Default deny** — koleksi tanpa rule = superuser saja.
- **Ownership** — `@request.auth.id != "" && user = @request.auth.id`.
- **Role** (`users.role`: `user|verifier|editor|admin`) — admin penuh; editor
  konten belajar & konten harian; verifier antrian verifikasi.
- Anti dobel klaim: unique index `(user, mission, period_date)`.
- `users`: registrasi publik dipaksa role `user` (create rule + hook);
  anti-eskalasi: user biasa tidak bisa PATCH `role/points/is_active/streak`
  (guard hook — updateRule tidak bisa membandingkan nilai lama vs baru).

## Verifikasi

```bash
node pocketbase/scripts/test.mjs    # 254 asersi: skema, seed, rules, audit, rate limit, guard login, scan AI, misi+gamifikasi, e-learning (kuis server-side + anti dobel), konten harian + cron, broadcast + FCM (endpoint mock: OAuth JWT RS256 diverifikasi), dashboard, cleanup, backup, guard read_at, rollback review (instance fault-injection) + Sentry + fallback log (sprint 13)
node pocketbase/scripts/e2e-sdk.mjs # 51 asersi E2E alur klien SDK (auth, profil, misi via route, verifikasi, streak, badge, scan, e-learning, realtime SSE, broadcast, daily-content, dashboard)
node pocketbase/scripts/smoke.mjs   # health + ping
```

## Settings bootstrap (sprint 10)

Migrasi `1757500000_settings_bootstrap.js` (jalan otomatis saat serve):

1. **Rate limit** (pengganti middleware Redis — nilai setara kebijakan PRD §6):
   `users:authWithPassword` 30/15 menit/IP, `users:authRefresh` 60/menit/IP,
   `users:create` 20/jam/IP, pelindung global `/api/` 300/10 dtk/IP. Rate
   limiter PB hanya per-IP; proteksi per-identitas ada di guard hook.
2. **Autodate `created`/`updated`** ditambahkan ke seluruh koleksi non-sistem
   (temuan v0.40: koleksi bawaan tidak lagi menyertakannya).
3. **OAuth2 Google** pada koleksi `users` — aktif hanya bila env
   `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` terisi (lihat `.env.example`).

## Security header reverse proxy (produksi)

PocketBase mengirim header dasar; lengkapi di reverse proxy (contoh Caddy —
Nginx setara dengan `add_header`):

```caddyfile
ekoteologi.example.id {
  reverse_proxy 127.0.0.1:8090
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options    "nosniff"
    X-Frame-Options           "DENY"
    Referrer-Policy           "strict-origin-when-cross-origin"
    Permissions-Policy        "camera=(self), geolocation=()"
    Content-Security-Policy   "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
    -Server
  }
}
```

Catatan: `connect-src 'self'` mencakup SSE `/api/realtime`; CSP longgar untuk
`style-src 'unsafe-inline'` karena Vue SFC admin/mobile menyuntik style saat
boot. Uji tiap header setelah deploy (mis. securityheaders.com).

## Catatan upgrade

Pre-1.0 — baca changelog sebelum naik versi; versi pin ada di: `Makefile`
(`PB_VERSION`), `Dockerfile` (`ARG PB_VERSION`), `.github/workflows/ci.yml`.
Jika naik versi, cek: format migrasi (`migrate`), API rules (`@request.*`),
dan jalankan `make pb-test` + smoke CI.
