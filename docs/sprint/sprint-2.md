# Laporan Sprint 2 — Scan AI: Backend

> Periode: 4 September 2026 · Kapasitas: 12 poin · Status: **selesai — 6/6 story diterima (12/12 poin)**
> Goal sprint: **`POST /scan` end-to-end: foto → LLM → JSON tervalidasi → tersimpan.**

---

## 1. Ringkasan

Fitur signature punya backend lengkap: satu panggilan `POST /v1/scan` menerima foto, memvalidasi
ukuran/format (magic bytes), memeriksa cache Redis per hash foto, memanggil LLM melalui adapter
(retry + fallback model + timeout), memvalidasi hasil dengan schema Pydantic ketat, mengganti quote
dengan bank terkurasi (anti-halusinasi), menyimpan baris `scans` lengkap dengan `llm_raw` + `llm_meta`
(PRD §5.3), lalu menambah poin lewat ledger append-only yang tersinkron ke `users.points`
(PRD §5.10 #1). Mock mode membuat seluruh ini berjalan dengan **biaya LLM nol** selama development —
provider asli tinggal `LLM_MODE=live` + env tanpa mengubah kode.

Bukti cepat (kriteria demo Sprint 2):

| Kriteria demo | Hasil |
|---|---|
| Curl/HTTP file → respons JSON valid | ✅ `curl -F file=@foto.png` → 200 dengan `{item_name, category, advice, quote, points, points_total, cached, duplicate, image_url, created_at}` |
| Mock mode terbukti di log | ✅ `INFO:ekoteologi.scan: SCAN cache MISS digest=ad6574a98803 — memanggil LLM (mode=mock)` + `SCAN OK … item='Popok sekali pakai' category=Residu points=2` |
| Cache terbukti di log | ✅ Foto sama → `SCAN cache HIT digest=ad6574a98803` tanpa panggilan LLM; kuota harian teruji: scan ke-3 (limit 2) → 429 "Kuota scan harian habis…" |
| CI hijau | ⏳ Verifikasi CI GitHub dicatat pasca-push — hasil akhir di §6 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Endpoint scan: upload → LLM → simpan (retry, fallback, timeout) | 5 | ✅ | `POST /v1/scan`; retry per model (timeout/429/5xx/respons tidak valid) → fallback `LLM_FALLBACK_MODEL` → 502 bila gagal total (tidak tersimpan); `llm_raw` + `llm_meta` terekam (PRD §5.3) |
| Prompt engineering + validasi schema (Pydantic) | 3 | ✅ | Prompt sistem Bahasa Indonesia dgn daftar kategori dari DB; `ScanLLMResult {item_name, category, advice, quote, points}` divalidasi ketat — gagal schema = gagal model = retry |
| LLM provider adapter + mock mode | 1 | ✅ | `LLMProvider` → `MockProvider` (deterministik per hash foto) & `OpenAICompatibleProvider`; pemilihan via `LLM_MODE` (default mock); model/key/base URL via env, nol hardcode |
| Cache Redis per item | 1 | ✅ | Kunci = SHA-256 isi foto (deterministik, tanpa perlu tahu jenis item di muka) + TTL via env; hit/miss dihitung di `scan:stats:*` (dasar metrik hit rate ≥70% PRD §8) |
| Rate limit scan/user/hari | 1 | ✅ | `SCAN_DAILY_LIMIT` (default 20, via env — keputusan §2.1 #2); 429 + `Retry-After`; **fail-closed** saat Redis mati (lihat §5) |
| Point ledger service (append-only + sync cache) | 1 | ✅ | `award_points()` menulis `point_transactions` + update `users.points` dalam satu transaksi; `sync_points_cache()` utk rekonsiliasi; tidak ada jalur update/delete ledger |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Endpoint baru** `POST /v1/scan` (`app/api/scan.py`): auth Bearer → validasi foto → konsumsi
  kuota → cache lookup → LLM → validasi → simpan → poin → respons. Error terpetakan: 400 (kosong/
  format), 413 (ukuran), 429 (kuota habis, dengan `Retry-After`), 503 (Redis mati — fail-closed),
  502 (LLM gagal setelah retry+fallback; **tidak ada** baris tersimpan).
- **Adapter LLM** (`app/services/llm/`):
  - `base.py` — kontrak `LLMProvider`, `LLMError`, prompt sistem (aturan output JSON, kategori
    wajib dari DB, bahasa Indonesia), `parse_llm_content()` (parsing + validasi schema +
    normalisasi kategori case-insensitive), helper retry dgn backoff.
  - `mock.py` — **MockProvider** deterministik per hash byte foto: 7 item realistis lintas
    kategori (Plastik/Organik/Kertas/Kaca/Logam/B3/Residu) sesuai seed `base_points`; tanpa
    jaringan, biaya nol — development & test tidak pernah menyentuh provider asli.
  - `openai_compat.py` — provider vision API OpenAI-compatible (mis. GLM-4.5V): gambar dikirim
    sebagai data-URL base64, model/key/base URL dari env, timeout per permintaan, retry per model,
    lalu fallback `LLM_FALLBACK_MODEL`; `llm_raw` = respons mentah penuh, tokens dari `usage`.
  - `__init__.py` — pabrik `get_llm_provider()`: `LLM_MODE=live` + konfigurasi lengkap → live;
    selain itu mock (dgn warning bila live tidak lengkap).
- **Service pendukung** (`app/services/`):
  - `scan_cache.py` — cache per hash foto (TTL `SCAN_CACHE_TTL_HOURS`), fail-open, penghitung
    hit/miss per lingkungan.
  - `scan_limit.py` — kuota harian (`INCR` per user+tanggal, kedaluwarsa tepat tengah malam) +
    guard foto duplikat per user/hari (`SET NX`) → poin 0 (anti poin-farming, PRD §9).
  - `ledger.py` — `award_points` (validasi amount > 0), `ledger_total` (SUM sumber kebenaran),
    `sync_points_cache` (rekonsiliasi drift cache).
  - `quotes.py` — bank quote ayat/hadis terkurasi per kategori + fallback umum; LLM tidak pernah
    menyumbang quote ke data tersimpan (PRD §9: quote dicocokkan dari bank, bukan digenerasi).
- **Schema** (`app/schemas/scan.py`): `ScanLLMResult` (kontrak LLM, divalidasi ketat sebelum
  dipakai), `Quote`, `ScanResponse` (termasuk `points_total`, `cached`, `duplicate` untuk UI
  Sprint 3).
- **Config**: env baru `LLM_MODE`, `LLM_FALLBACK_MODEL`, `LLM_TIMEOUT_SECONDS`, `LLM_MAX_RETRIES`,
  `LLM_RETRY_BACKOFF_SECONDS`, `SCAN_DAILY_LIMIT`, `SCAN_IMAGE_MAX_MB`, `SCAN_CACHE_TTL_HOURS`,
  `SCAN_CACHE_SCHEMA` (`.env.example` + README diperbarui; tidak ada hardcode).

### 3.2 Tooling kualitas

- **Coverage mulai diukur** (komitmen Sprint 0/1): `pytest-cov` ditambahkan; gate **coverage ≥70%**
  diterapkan di CI dan `make api-cov`. Hasil saat ini: total **88%** (modul Sprint 2: ledger/quotes/
  mock 100%, base 96%, openai_compat 92%, scan_limit 93%, endpoint scan 77%*).
- Test 51 → **89** (ledger 4, adapter LLM 15, endpoint scan 13, sisanya existing).
- CI job api kini `uv run pytest -q --cov=app --cov-report=term-missing --cov-fail-under=70`.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 89 lulus, coverage 88% (gate 70% tercapai) |
| ruff check + format | `make api-lint` | ✅ bersih |
| Demo end-to-end | curl register → 3× `POST /v1/scan` (foto sama/beda) | ✅ JSON valid; MISS→LLM(mock)→poin; HIT tanpa LLM; duplikat→poin 0 |
| Bukti log | `grep ekoteologi /tmp/uvicorn-sprint2.log` | ✅ `SCAN cache MISS … mode=mock`, `SCAN cache HIT …`, `SCAN OK …` |
| Kuota harian | server dgn `SCAN_DAILY_LIMIT=2` → scan ke-3 | ✅ 429 `"Kuota scan harian habis (maksimal 2 kali per hari)…"` |
| Redis mati | test: dependency Redis di-stub `RedisError` | ✅ 503 fail-closed (pelindung budget) |
| LLM gagal | test: provider di-stub `LLMError` | ✅ 502, tidak ada baris `scans`/ledger/poin |
| Provider live (tanpa jaringan) | `httpx.MockTransport`: sukses, retry, fallback, gagal total | ✅ 7 skenario termasuk `attempts`/`fallback_used` di `llm_meta` |
| Regresi Sprint 0–1 | suite penuh | ✅ 51 test lama tetap hijau |
| CI GitHub | run pada push `aca8c82` — hasil dicatat di §6 | ⏳ dipantau pasca-push |

---

## 5. Keputusan & Catatan Teknis

1. **Kunci cache = hash SHA-256 isi foto**, bukan nama item. PRD menyebut "cache per jenis item";
   dalam praktik jenis item baru diketahui *setelah* LLM menganalisis, sehingga cache yang benar-
   benar menghemat biaya adalah cache atas isi foto (deterministik, instan). Efeknya setara untuk
   kasus umum (foto/item yang sama → respons instan gratis) dan sekaligus menjadi dasar guard
   duplikat anti poin-farming. Penghitung hit/miss sudah disiapkan agar target hit rate ≥70%
   (PRD §8) terukur di dashboard Sprint 4.
2. **Rate limit scan fail-CLOSED, rate limit login fail-open** (keputusan Sprint 1): sumber daya
   yang dilindungi berbeda. Login = ketersediaan; scan = **budget LLM nyata** — saat Redis mati
   justru cache ikut mati sehingga biaya per scan naik; membiarkan scan lewat tanpa batas berisiko
   biaya tak terbatas. Kondisi Redis mati → 503 dengan pesan ramah. Dibahas ulang di Sprint 8
   (hardening) bila PO menghendaki perilaku lain.
3. **Quote selalu dari bank terkurasi** (`services/quotes.py`), bukan dari LLM — mitigasi eksplisit
   risiko halusinasi (PRD §9). LLM tetap diminta menyarankan quote (kontrak respons PRD §2.2 tetap
   utuh), tapi saran itu hanya tercatat di `llm_raw`, tidak pernah tampil ke user. Bank berada di
   kode (bukan DB) untuk MVP; memindahkannya ke tabel (agar editor admin mengelola) bisa jadi story
   menyusul.
4. **Poin = min(usulan LLM, `base_points` kategori)**: schema meminta LLM mengusulkan poin 0–100
   (kontrak PRD), tetapi langit-langit `base_points` kategori mencegah poin dilampiaskan — satu
   lapis anti poin-farming tambahan.
5. **Foto duplikat per user per hari → analisis tetap diberikan (dari cache) tapi poin 0**
   (`duplicate: true` di respons), sesuai mitigasi PRD §9 ("hash foto, cooldown"). Foto sama oleh
   user berbeda tetap mendapat poin penuh (cache HIT) — wajar karena analisis memang benar.
6. **Live provider OpenAI-compatible generik**: base URL, key, model, fallback model, timeout,
   retry semuanya env — mendukung keputusan PRD §4 "model mudah ditukar". Belum diuji terhadap
   provider sungguhan (butuh staging + API key — lihat §7); seluruh perilaku jaringan diuji dengan
   `httpx.MockTransport` (parse, retry, fallback, kegagalan total).
7. **Catatan pengukuran coverage**: pytest-cov di lingkungan ini *kekurangan-lapor* sebagian baris
   body endpoint async — teramati juga pada `auth.py` sejak Sprint 1 (frame setelah `await` di
   tengah request tidak selalu tercatat, konsisten di ketiga tracer core coverage: sysmon/ctrace/
   pytrace; repro minimal di luar app justru 100%, sehingga diduga interaksi khusus stack
   FastAPI/Starlette/pytest-asyncio). Karena itu angka coverage endpoint adalah batas bawah; gate
   70% tetap bermakna karena dihitung atas total (88%). Dicatat di `api/README.md` dan ditindak-
   lanjuti bila ditemukan akar masalahnya.
8. Kuota harian default **20/user/hari** dipilih sebagai asumsi kerja keputusan §2.1 #2 (budget
   LLM masih terbuka dari Sprint 1); karena nilainya env, PO dapat menyetel ulang tanpa deploy.

---

## 6. DoD Sprint 2 — Checklist

- [ ] CI hijau di GitHub — dipantau pasca-push (lokal sudah hijau: 89 test, ruff bersih,
      coverage 88% ≥ gate 70%); hasil akhir dicatat pada commit "catat hasil run CI".
- [x] Unit test logika baru: adapter LLM (mock deterministik, parser, retry/fallback live via
      MockTransport), ledger (append-only + rekonsiliasi), cache hit/miss, kuota harian +
      fail-closed, guard duplikat, endpoint end-to-end dgn mock mode. Total 89 test.
- [x] Konfigurasi via env tanpa hardcode: `LLM_MODE/API_KEY/BASE_URL/MODEL/FALLBACK_MODEL/…`,
      `SCAN_DAILY_LIMIT`, `SCAN_CACHE_*` (lihat `.env.example`).
- [x] Terdokumentasi: `api/README.md` — kontrak `POST /v1/scan`, arsitektur Scan AI, env baru,
      contoh respons, catatan coverage.
- [x] Mock mode dipakai di seluruh test — tidak ada pemanggilan provider asli (live diuji lewat
      `httpx.MockTransport`).
- [ ] UI 100% tokens.css / a11y / perangkat nyata — **tidak berlaku sprint ini** (tanpa UI; story
      UI scan ada di Sprint 3).

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | **Hosting staging (plan §2.1 #5)** — masih terbuka sejak Sprint 0 | `/v1/scan` live belum teruji terhadap provider vision sungguhan; integrasi LLM asli butuh staging + `LLM_API_KEY` | **Segera** — sebelum Sprint 3 demo scan di perangkat |
| 2 | Akun provider LLM + `LLM_API_KEY` (plan §2.2) | Menentukan nilai default `SCAN_DAILY_LIMIT` final | Sebelum demo Sprint 3 |
| 3 | Akuisisi foto demo Sprint 3: kamera perangkat nyata (plan risiko #1) | QA matrix kamera | Sebelum Sprint 3 |
| 4 | Sisa wiring Google Sign-In native (Sprint 1) | Masih menunggu OAuth Client ID | Fleksibel |

---

## 8. Yang Menyusul (Sprint 3 — Scan AI: Mobile)

UI scan (kamera preview + overlay + sheet hasil sesuai `mobile/scan.html`), riwayat scan + filter
kategori, integrasi poin scan ke ledger dari sisi mobile (+ batas harian di UI), consent + storage
foto (PRD §9), uji lapangan di perangkat (target hasil <2 detik dgn cache), dan dashboard admin
read-only (KPI cards). Kontrak `POST /v1/scan` (termasuk `cached`/`duplicate`/`points_total` di
respons) sudah final dan siap dikonsumsi.
