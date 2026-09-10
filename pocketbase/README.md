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

Route bisnis menyusul: klaim/verifikasi misi + engine gamifikasi (sprint 12),
kuis & notif (sprint 13).

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
| `missions` | missions | publik (aktif); admin semua | admin |
| `user_missions` | user_missions | pemilik + staff (verifier/editor/admin) | create pemilik; update pemilik + verifier/admin |
| `modules` | modules | publik (terbit); admin semua | admin + editor |
| `lessons` | lessons | modul terbit | admin + editor |
| `quizzes`, `quiz_questions` | quizzes, quiz_questions | modul terbit | admin + editor |
| `user_module_progress` | user_module_progress | pemilik | pemilik |
| `user_quiz_attempts` | user_quiz_attempts | pemilik | create pemilik (append-only) |
| `daily_contents` | daily_contents | publik (publish_date lewat / hari ini) | admin + editor |
| `posts`, `post_likes`, `post_comments` [fase 2] | community.py | publik (non-hidden, tak terhapus); like publik | pemilik; soft delete |
| `reports` | community.py | admin | create user (reporter = diri) |
| `map_locations` | community.py | publik | admin |
| `rewards` [fase 2] | reward.py | publik (aktif) | admin |
| `redemptions` [fase 2] | reward.py | pemilik / admin | create pemilik; update admin |
| `notifications` | system.py | pemilik + broadcast (user kosong) | terkunci — hook (sprint 13); update read_at pemilik |
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
node pocketbase/scripts/test.mjs    # 98 asersi: skema, seed, rules, audit, rate limit, guard login, scan AI (sprint 11)
node pocketbase/scripts/e2e-sdk.mjs # 26 asersi E2E alur klien SDK (auth, profil, misi, verifikasi, scan)
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

## Catatan upgrade

Pre-1.0 — baca changelog sebelum naik versi; versi pin ada di: `Makefile`
(`PB_VERSION`), `Dockerfile` (`ARG PB_VERSION`), `.github/workflows/ci.yml`.
Jika naik versi, cek: format migrasi (`migrate`), API rules (`@request.*`),
dan jalankan `make pb-test` + smoke CI.
