# Laporan Sprint 11 — Scan AI via Custom Route

> Periode: 10 September 2026 · Kapasitas: 13 poin · Status: **selesai — 7/7 story
> diterima (13/13 poin)** · Goal sprint: *`POST /api/ekoteologi/scan` end-to-end
> di PocketBase: foto → LLM → JSON tervalidasi → tersimpan + poin.*
> Bonus verifikasi: 9Router ternyata **tersedia di lingkungan dev ini**
> (asumsi awal: tidak ada) sehingga mode LIVE diuji sungguhan, bukan sekadar
> "fallback error rapi" — termasuk fallback model & cache live (§5, §6).

---

## 1. Ringkasan

Sprint ketiga migrasi (implementation-plan §4 Epic B3). Alur scan unggulan kini
hidup penuh di PocketBase dalam **satu panggilan custom route**
`POST /api/ekoteologi/scan` (`pb_hooks/scan.pb.js`): auth wajib → multipart
foto → validasi ukuran+magic bytes → kuota harian (fail-closed) → cache
(L1 `$app.store()` + L2 koleksi `llm_cache`) → LLM mock/live (9Router) dengan
retry+fallback → JSON tervalidasi ketat → quote bank terkurasi (anti-halusinasi)
→ foto+hasil tersimpan + poin via **ledger append-only** yang menyinkronkan
`users.points` dalam transaksi yang sama.

Dua "menunggu Sprint 11" dari laporan Sprint 10 tuntas: `submitScan` tidak
lagi menyimpan foto `pending_ai` tanpa analisis, dan kuota harian kini
dihitung server-side (route `GET /api/ekoteologi/scan/quota`) — hitungan
klien Sprint 10 dipensiunkan. Koleksi `scans` ikut dikunci dari API tulis
(createRule dihapus): scan hanya lahir lewat route — poin/item_name tidak
bisa dipalsukan klien.

Bukti cepat (kriteria demo):

| Kriteria demo | Hasil |
|---|---|
| Scan di perangkat → hasil < 2 detik dgn cache | ✅ cache hit terukur: scan ke-2 foto sama **0,015 s** vs 24,7 s panggilan LLM live (dan instan di mock). Uji sentuh perangkat asli tetap menunggu APK internal testing (Sprint 13 QA — catatan sama dgn Sprint 10) |
| Mock mode & cache terbukti di log | ✅ log hook: `SCAN cache MISS digest=… — memanggil LLM (mode=mock)` / `SCAN cache HIT digest=…` / `SCAN OK … points=… cached=true duplicate=false`; route `GET /api/ekoteologi/scan/stats` mengekspos hit/miss: **1 miss + 3 hit = 75% (target ≥70%)** — terasersi otomatis |
| End-to-end klien | ✅ E2E SDK 26 asersi: `pb.send('/api/ekoteologi/scan', FormData)` → kontrak hasil → poin tersinkron (authRefresh) → scan ulang = cache+duplikat poin 0 → riwayat+expand kategori → kuota via route |

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Custom route scan di `pb_hooks` (auth, multipart, validasi ukuran/tipe) | 2 | ✅ | `POST /api/ekoteologi/scan` + middleware `$apis.requireAuth("users")` + guard defensif. Foto dibaca `e.findUploadedFiles("image")`, byte via `toBytes(reader)` (Go-side, byte-exact), batas `SCAN_IMAGE_MAX_MB` (413), magic bytes JPG/PNG/WebP (400 — extension filename tidak dipercaya: PB hanya mendeteksi konten bila nama tanpa ekstensi). Error 400/401/413/429/502 semua berbahasa Indonesia. |
| Port LLM adapter ke JSVM: mock mode + openai_compat (`$http.send` → 9Router), config via env, timeout/retry/fallback | 3 | ✅ | `pb_hooks/scan.pb.js`: **mock** = item deterministik dari digest (port `llm/mock.py`, foto sama → hasil sama → cache teruji); **live** = `$http.send` POST `{LLM_BASE_URL}/chat/completions` (9Router `127.0.0.1:20128/v1`) dgn `LLM_MODEL`, retry per model (`LLM_MAX_RETRIES`, backoff `sleep()` — goja punya sleep global!), `LLM_TIMEOUT_SECONDS`, lalu `LLM_FALLBACK_MODEL`; keduanya diakhiri validasi ketat — gagal validasi = gagal percobaan. Prompt port `llm/base.py` (kategori disuntik dari DB). **Teruji live ke 9Router asli** (§6): primer glm-4.6v sukses; kasus primer gagal → fallback Kimi-K2.5 sukses; endpoint mati → 502 rapi. |
| Validasi respons JSON + rekam `llm_raw`/`llm_meta` | 2 | ✅ | Validator port `ScanLLMResult` (item_name 2-100, advice 5-1000, points int 0-100, quote opsional, kategori dicocokkan case-insensitive ke `waste_categories`; code fence dibersihkan; respons 9Router yang berakhiran `data: [DONE]` diparse toleran). `scans.llm_raw` = respons mentah provider; `llm_meta` = `{provider, model, latency_ms, tokens, attempts, fallback_used, cached}`. Quote LLM selalu diganti bank quote terkurasi per kategori (port `services/quotes.py` — anti-halusinasi PRD §9). |
| Cache `llm_cache` (koleksi + in-memory map) — hit rate ≥70% | 1 | ✅ | L1 `$app.store()` (in-memory Go-side, lintas executor pool — Map JS top-level TIDAK bisa: handler di-stringify ke VM lain) berisi string JSON + TTL; L2 koleksi `llm_cache` (`key="scan:"+digest`, tahan restart). Kunci = sha256 **atas representasi base64** byte foto (lihat §4 #5). Hit/miss dicatat `app_settings` `scan_cache_stats`; stats route melaporkan hit_rate. Uji beban: 1 miss + 3 hit = **75%** ✅ (live: 24,7 s → 0,015 s). |
| Rate limit scan/user/hari (hook + koleksi counter) | 1 | ✅ | Counter `scan_quota:{uid}:{tanggal}` di `app_settings` (transaksi `runInTransaction`, key ≤50 char — temuan §4 #6), env `SCAN_DAILY_LIMIT` default 20, **fail-closed** (DB gagal → 503 — pelindung beban 9Router, paritas kebijakan lama). Kuota habis → 429 + header `Retry-After` + body `retry_after` (paritas endpoint kuota FastAPI `GET /scan/quota` juga dibuat). Percobaan yang ditolak ikut terhitung — paritas Redis INCR. |
| Ledger hook: append-only + sinkron `users.points` (transaksional) | 2 | ✅ | Hook MODEL-level `onRecordCreate` `point_transactions`: validasi `amount` bulat > 0 + user ada → `users.points += amount` dengan `e.app` yang sudah transaksional (scan→ledger→poin ATOMIK via `runInTransaction`). `onRecordUpdate`/`onRecordDelete` menolak total (append-only; PATCH/DELETE via superuser → 400, teruji). Hook ini dipicu juga oleh tulisan internal → siap dipakai ulang Sprint 12 (klaim/verifikasi). Koleksi tetap default-deny dari API publik. |
| Mobile: riwayat scan + filter kategori + integrasi sheet hasil ("+N Poin") | 2 | ✅ | `services/scan.ts`: `submitScan` → `pb.send('/api/ekoteologi/scan', FormData)` (requestKey null — tak ter-autocancel); `fetchQuota` → route kuota (hitungan klien Sprint 10 pensiun); riwayat + filter kategori & chips 7 kategori tetap (kini `item_name`/kategori terisi hasil AI). Sheet hasil: tag `+N POIN` / `POIN 0`, tombol `Saya Sudah Pilah (+N Poin)`, state `Menganalisis objek…`, catatan baru "hasil instan dari cache" & duplikat; `auth.applyPoints(points_total)` memperbarui pill poin header. `toApiError` kini membaca `retry_after` body (paritas Retry-After yang tak terbaca SDK). |

## 3. Yang Dibangun

### 3.1 `pocketbase/` (backend)

- **`pb_hooks/scan.pb.js`** (baru) — 3 route (`POST /scan`,
  `GET /scan/quota`, `GET /scan/stats`) + 3 hook model ledger
  (`point_transactions` create/update/delete). Seluruh helper self-contained
  di dalam handler (batasan closure JSVM — §4 #1).
- **`pb_migrations/1757400000_init_schema.js`** — `scans` tidak lagi punya
  `createRule` (tulis terkunci via route hook); baca tetap ownership.
- **`pb_hooks/main.pb.js`** — versi ping default `0.1.0-sprint11` + catatan
  pindah domain scan.
- **`scripts/test.mjs`** — 65 → **98 asersi** (§9 scan AI: auth/validasi,
  kontrak respons, sinkron poin, ledger, llm_raw/meta, duplikat, cache hit
  rate, kuota 429+Retry-After, audit, event scan_pertama, append-only;
  §4/§6/§8 disesuaikan kunci scans).
- **`scripts/e2e-sdk.mjs`** — 19 → **26 asersi** (§8: scan via `pb.send`
  persis jalur mobile, sinkron poin authRefresh, cache+duplikat, riwayat
  expand kategori, kuota, stats).
- **README.md + .env.example** — kontrak 3 route + hook ledger, env baru
  (`LLM_MAX_RETRIES`, `LLM_TIMEOUT_SECONDS`, `LLM_MAX_TOKENS`,
  `SCAN_DAILY_LIMIT`, `SCAN_IMAGE_MAX_MB`, `SCAN_CACHE_TTL_HOURS`),
  catatan model vision/reasoning.

### 3.2 `mobile/`

- `services/scan.ts` — `submitScan` ke route kustom (pemetaan kontrak penuh,
  `image` → `fileUrl`), `fetchQuota` ke route kuota.
- `api/client.ts` — `toApiError` mengekstrak `retry_after` (body level atas /
  nested) → `ApiError.retryAfterSeconds` (sheet error menampilkan estimi reset).
- `types/scan.ts` — `pending_ai` dihapus (server selalu menganalisis kini);
  doc cached/duplicate.
- `views/ScanView.vue` — catatan cache baru ("hasil instan dari cache"),
  toast duplikat, copy header; state "Menganalisis objek…" & "+N POIN" dari
  Sprint 3 dipertahankan dan kini selalu terisi hasil nyata.

### 3.3 Infra

- Tidak ada perubahan compose/Dockerfile/CI — job `backend` CI otomatis
  menjalankan lint JS (glob `pb_hooks/*.pb.js` mencakup file baru), test 98
  asersi, E2E SDK 26 asersi, smoke.

## 4. Keputusan Teknis (dan temuan penting v0.40/JSVM)

1. **Handler JSVM di-stringify ke executor pool** (terbukti ulang saat sprint
   ini): helper top-level file (mis. `makeSha256()`) → `ReferenceError` di
   handler. Seluruh helper scan (bank quote, base64, prompt, validator, cache,
   kuota) hidup DI DALAM handler; duplikasi antar route DISENGAJA.
2. **`e.findUploadedFiles(key)`** (router v0.40) mengembalikan
   `filesystem.File` dari multipart; byte dibaca `toBytes(file.reader.open(),
   max)` → array bita eksak (Go-side read). Catatan: PB hanya mendeteksi mime
   dari KONTEN bila nama file tanpa ekstensi (`normalizeName`) — jadi magic
   bytes dicek sendiri di hook; `file.name` tidak dipercaya.
3. **State in-memory lintas executor = `$app.store()`** (Go-side sync store).
   `Map` top-level terfragmentasi antar VM; store berisi STRING JSON agar aman
   antar VM. Lapisan tahan-restart tetap koleksi `llm_cache`.
4. **`$security.sha256(string)` korup untuk byte ≥0x80** (goja meng-encode
   UTF-8; string biner → 2 byte). String ASCII aman → **digest = sha256
   Go-side atas BASE64 foto** (byte-exact & cepat). sha256 murni-JS terbukti
   benar tapi ~2 detik/512KB di goja — tak layak. Base64 dibangun manual di JS
   (JSVM tanpa `btoa`); 512KB ≈ 0,27 s, foto kamera tipikal ≪ itu.
5. **`sleep(ms)` ternyata global JSVM** (binds.go) → retry backoff paritas
   `asyncio.sleep` versi FastAPI.
6. **`app_settings.key` max 50 karakter** — kunci duplikat pertama
   (`scan_dup:{uid}:{tanggal}:{digest64}` = 100 char) diam-diam gagal validasi
   (tersimpan log) sehingga duplikat tak terdeteksi; diganti satu baris
   per user+hari `sd:{uid}:{tanggal}` berisi daftar prefix digest 32-hex
   (128-bit).
7. **`ApiError(status, message, data)` mengharapkan `data` sebagai peta error
   validasi per field** — mengirim `{retry_after: n}` menghasilkan
   `data.retry_after = {code: "validation_invalid_value", …}`. Karena itu 429
   kuota dikembalikan lewat `e.json(429, {code, message, retry_after})` +
   header `Retry-After` (terverifikasi bisa di-set via `e.response.header()`).
8. **9Router live: respons bisa berakhiran `data: [DONE]\n\n`** → `res.json`
   dari `$http.send` gagal; body bita diubah ke string lalu JSON diekstraksi
   toleran (potong di `}` terakhir). Model reasoning (mis. glm-4.6v dengan
   `max_tokens` kecil) bisa mengembalikan konten kosong — diperlakukan gagal
   percobaan → retry/fallback (dokumentasi env menyarankan `LLM_MAX_TOKENS`
   lebih besar untuk model reasoning).
9. **`scans` dikunci dari tulisan klien** (createRule dihapus): scan hanya
   dibuat route hook, sehingga `points`/`item_name` tidak bisa dipalsukan.
   Test §4/§6/§8 disesuaikan (autodate kini diasersi via record superuser).
10. **Kuota fail-closed & INCR-paritas**: counter dinaikkan sebelum cek (429
    juga menghabiskan satu slot) — persis perilaku Redis INCR versi FastAPI;
    foto tidak valid (400/413) TIDAK menghabiskan kuota (validasi lebih dulu).
11. **Audit route manual**: pembuatan record lewat konteks internal tidak
    memicu hook request-level, jadi route menulis baris audit sendiri
    (`action=scan`, diff berisi item/kategori/poin/cached/duplicate/mode).

## 5. Penyimpangan & catatan jujur

- **Kejutan lingkungan: 9Router AKTIF di 127.0.0.1:20128** (asumsi sprint:
  tidak ada). Mode live diuji lebih jauh dari rencana (§6) — mock tetap
  default dev/test dan seluruh CI tetap mock (deterministik, tanpa jaringan).
  Latensi live ~25-30 s per foto (model reasoning + fallback) — deployment
  produksi tinggal memilih model non-reasoning yang lebih cepat via env tanpa
  deploy kode.
- **Menunggu Sprint 12 (misi & gamifikasi)** — kini tinggal tipis karena hook
  ledger sudah matang: poin klaim/approve misi belum mengalir (verifier masih
  hanya menetapkan `points_awarded`); level/streak/badge engine + progres
  `auto_scan` + notifikasi verifikasi menyusul (scan sengaja TIDAK menyentuh
  streak/badge/misi — scope sprint ini, paritas pemisahan Sprint 2 vs 5 di
  FastAPI).
- **Menunggu Sprint 13**: agregasi dashboard admin (KPI scan/LLM/cache via
  SQL `$app.db`) — kartu dashboard masih "menunggu route agregasi"; pembersihan
  kunci `app_settings` kedaluwarsa (`scan_quota:*`, `sd:*` per tanggal) dan
  `llm_cache` kedaluwarsa dijadwalkan masuk cron/hardening Sprint 13 (saat ini
  kedaluwarsa ditangani lazy saat dibaca); uji sentuh perangkat Android nyata
  menunggu APK internal testing.
- **Sinkronisasi antar-executor**: hitungan kuota/duplikat disimpan DB
  (aman), tetapi read-modify-write counter bisa race pada konkurensi tinggi
  (SQLite serialize tulis; off-by-one mungkin) — paritas MVP, dipantau
  hardening Sprint 13.
- Riwayat scan kini menampilkan hasil AI penuh; foto lama milik pengembangan
  yang terlanjur `pending_ai` (tanpa item_name) tetap tampil apa adanya di
  riwayat — tidak ada migrasi data dev (keputusan M4 untuk staging).

## 6. Verifikasi (bukti lokal, semua lulus)

| Perintah | Hasil |
|---|---|
| `make pb-test` | **98 PASS / 0 FAIL** — termasuk §9 scan AI: 401/400/413 guard, kontrak respons, `users.points` tersinkron, ledger (source/ref_id/amount), `llm_raw`+`llm_meta`, duplikat poin 0, cache lintas user, hit rate **75%** (`hit=3 miss=1`), kuota `used/limit/remaining`, 429 + `Retry-After` header + `retry_after` body, audit `action=scan`, event `scan_pertama`, PATCH/DELETE/amount≤0 ledger ditolak |
| `make pb-e2e` | **26 PASS / 0 FAIL** — §8 baru: scan via `pb.send` multipart (jalur persis mobile) → kontrak → authRefresh poin sinkron → scan ulang cache+duplikat → riwayat+expand kategori → kuota route → stats |
| `make pb-smoke` | PASS `/api/health`, PASS `/api/ekoteologi/ping` |
| **Uji LIVE 9Router** (env `LLM_MODE=live`, `LLM_BASE_URL=127.0.0.1:20128/v1`) | ① primer `glm/glm-4.6v` (max_tokens 4000): **200** — "Botol plastik", kategori Plastik, 5 poin (cap base_points), `attempts=1`, `latency_ms≈28800` ② primer gagal (konten kosong) → **fallback `cmc/moonshotai/Kimi-K2.5` sukses**, `fallback_used=true` ③ cache live: scan ke-2 foto sama **0,015 s** (vs 24,7 s), `cached=true`, `duplicate=true`, poin 0 ④ endpoint mati (port 19999) → **502** + pesan "Layanan analisis sedang gangguan…" (retry+fallback dijalankan dulu) |
| Lint JS backend | `node --check` semua `pb_hooks/*.pb.js`, `pb_migrations/*.js`, `scripts/*.mjs` |
| Admin | `npm run lint` ✅ · `npm run test` 29/29 ✅ · `npm run build` (vue-tsc + vite) ✅ |
| Mobile | `npm run lint` ✅ · `npm run test` 81/81 ✅ · `npm run build` ✅ · `npx cap sync android` ✅ |
| Pin versi | PocketBase v0.40.3 & SDK `pocketbase` 0.28.1 tidak berubah |

## 7. Blocker

Tidak ada blocker. Prasyarat eksternal sebelumnya justru membaik: 9Router
terbukti tersedia & kompatibel dgn adapter live. Sisa prasyarat lama yang
belum tersedia tetap: kredensial Google OAuth (Sprint 10) dan uji sentuh
perangkat asli (Sprint 13 QA).

## 8. Hasil Run CI

| Run | Commit | Hasil |
|---|---|---|
| #28 | `739c69a` (batch sprint 11) | ✅ 4/4 job hijau (Backend: lint JS → test integrasi 98 asersi → E2E SDK 26 asersi → smoke; Admin; Mobile web; Mobile APK) |

## 9. Ke Sprint 12

Loop scan tertutup; poin mengalir lewat ledger yang siap dipakai ulang.
Sprint 12 tinggal menyambungkan: klaim misi → verifikasi → ledger (+notif),
lalu level/streak/badge engine di atas `point_transactions` dan `scans`.
