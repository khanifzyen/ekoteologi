# Implementation Plan — Ekoteologi AR (Scrum)

> Rencana eksekusi development MVP berbasis Scrum. Mengacu pada `docs/PRD.md` (fitur, skema DB,
> epics) dan hasil tahap desain D0–D4 (`docs/DESIGN.md`, `docs/desain/` — mockup mobile & admin)
> sebagai acuan UI.
>
> Status: siap dieksekusi | Timeline: 9 sprint × 2 minggu ≈ 18 minggu (~4,5 bulan)

---

## 1. Kerangka Scrum

### 1.1 Tim (usulan)

| Peran | Jumlah | Fokus |
|---|---|---|
| Product Owner | 1 | Prioritas backlog, keputusan PRD §6, demo review |
| Scrum Master | 1 (bisa rangkap PO) | Prosess, blocker |
| Backend Dev (FastAPI) | 1 | API, LLM integrasi, DB, Redis |
| Frontend Dev Mobile (Vue + Capacitor) | 1 | User app Android |
| Frontend Dev Admin (Vue) | 1 (bisa digabung dgn mobile) | Panel admin |
| QA Engineer | 1 | Test plan, device matrix, regresi |

### 1.2 Ceremoni & ritme (sprint = 2 minggu)

| Acara | Kapan | Output |
|---|---|---|
| Sprint Planning | Hari 1 pagi | Sprint goal + komitmen story |
| Daily Standup | Tiap hari, 15 menit | Sinkron blocker |
| Backlog Refinement | Minggu ke-2, 1× | Story sprint berikutnya siap (DoR) |
| Sprint Review + Demo | Hari terakhir | Demo perangkat asli + keputusan PO |
| Retrospective | Setelah review | 1–2 perbaikan proses |

### 1.3 Definition of Ready (DoR) — story boleh masuk sprint jika:

- Acceptance criteria tertulis & terukur.
- Ada referensi desain (`docs/desain/…`) ATAU dinyatakan "tanpa UI".
- Dependensi API/data sudah diidentifikasi (kontrak endpoint minimal).
- Estimasi poin sudah disepakati tim.

### 1.4 Definition of Done (DoD) — semua story

- [ ] Kode review disetujui (≥1 reviewer), CI hijau (lint + test + build).
- [ ] Unit test untuk logika bisnis (poin, verifikasi, kuis); coverage BE ≥70%.
- [ ] Implementasi UI 100% dari `tokens.css` — nol hardcode warna/jarak (rujukan audit: `docs/desain/AUDIT.md`).
- [ ] State lengkap: loading (skeleton), empty, error, offline bila layar data.
- [ ] Aksesibilitas: tap target ≥44px, kontras AA, `prefers-reduced-motion`, focus-visible.
- [ ] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata (mobile) / Chrome+Firefox (admin).
- [ ] Terdokumentasi (README modul / kontrak endpoint).

### 1.5 Estimasi

Mapping poin: **S = 1, M = 3, L = 5**. Asumsi velocity **11–13 poin/sprint** (3–4 dev + QA).
Total backlog MVP: **±105 poin → 9 sprint** (PRD mencantumkan Sprint 0–7 / 8 sprint; +14 poin
story komponen & dashboard turunan mockup desain D1–D3, sehingga realistisnya 9 sprint).

---

## 2. Prasyarat Sebelum Sprint 0

### 2.1 Keputusan PRD §6 yang wajib ditutup

| # | Keputusan | Deadline | Blokir |
|---|---|---|---|
| 1 | Scope respons LLM (klasifikasi vs +saran+quote) | Sebelum Sprint 2 | Epic Scan |
| 2 | Budget LLM → rate limit/user/hari | Sebelum Sprint 2 | Epic Scan |
| 5 | Hosting (VPS vs Railway/Fly.io) | Sebelum Sprint 0 | Setup & deploy |
| 6 | Consent privasi foto bukti + retensi | Sebelum Sprint 4 | Klaim misi photo |

Diasumsikan sudah final: bahasa Indonesia saja (#3), reward digital fase 2 (#4), verifikasi per
kolom `missions.verification` (#7).

### 2.2 Akun & akses

- API key provider LLM vision (env `LLM_API_KEY`, model via env — tidak hardcode).
- Google Cloud project + FCM (Sprint 6), Google Sign-In OAuth client (Sprint 1).
- Play Console (untuk internal testing, Sprint 8), Sentry project.
- Domain + SSL untuk API & admin.

---

## 3. Ringkasan Backlog MVP

| Epic | Isi | Poin | Sprint |
|---|---|---|---|
| E1 Fondasi | Monorepo, CI, auth, scaffold, token | 15 | 0–1 |
| E2 Scan + AI | Endpoint LLM, kamera, poin, riwayat | 19 | 2–3 |
| E3 Misi | CRUD, klaim, verifikasi, UI | 17 | 4–5 |
| E4 Gamifikasi | Level, badge, streak, leaderboard, profil | 11 | 5–6 |
| E5 E-Learning | Modul, kuis, konten harian | 12 | 7 |
| E6 Rilis | FCM, composer, QA, hardening, Play Store | 17 | 6–8 |
| Turunan desain | Home assembly, dashboard admin, komponen, consent, seed | 14 | 0–6 |
| **Total** | | **105** | 0–8 |

> Backlog Fase 2 (leaderboard agregat, komunitas, peta, reward, PWA offline penuh — PRD §6/§7
> Epic 7) tidak diestimasi; di-refine menjelang Sprint 8.

---

## 4. Sprint Plan

> Setiap sprint punya **Design Input** (mockup acuan) dan **Demo** (kriteria review).

### Sprint 0 — Fondasi Teknis (12 poin)

**Goal:** Monorepo hidup, CI hijau, APK debug ter-build, admin shell tampil.

| Story | Poin | Catatan / Acuan Desain |
|---|---|---|
| Monorepo `api/ admin/ mobile/` + CI (lint, test, build) | 3 | GitHub Actions; docker-compose Postgres+Redis untuk lokal |
| FastAPI + Alembic + PostgreSQL + Redis + env config | 3 | Struktur per PRD §5; skema migrasi awal |
| Mobile scaffold Vue + Capacitor, build APK debug | 3 | Frame 480px terpusat, safe-area |
| Admin scaffold + login + role guard | 1 | Acuan: `admin/index.html` (shell: sidebar, topbar) |
| Audit log middleware | 1 | Tabel `audit_logs` |
| Salin `tokens.css` + komponen inti (Button, Card, Chip, Input, Tabs, Skeleton, Toast) | 1 | Sumber: `docs/desain/tokens.css`, `mobile/base.css` → `*/src/styles/` |

**Demo:** APK terpasang di perangkat; admin login tampil sesuai shell mockup.

### Sprint 1 — Auth & Onboarding (12 poin)

**Goal:** User baru bisa daftar → masuk → sampai beranda (kosong).

| Story | Poin | Acuan Desain |
|---|---|---|
| Auth email+password, JWT refresh, rate limit login | 3 | `mobile/auth.html` |
| Google Sign-In (Capacitor) | 1 | `mobile/auth.html` |
| Onboarding + splash (3 slide, dots, skip) | 1 | `mobile/onboarding.html` |
| Profil dasar (nama, avatar, kota) + endpoint | 3 | Komponen header `beranda.html` |
| Komponen state (skeleton, empty, error, offline-bar, toast) | 1 | `mobile/base.css` + switcher state di mockup |
| Seed data awal + dokumentasi API | 3 | `waste_categories`, `levels`, `badges` |

**Demo:** Alur onboarding→login→beranda di perangkat; error state tampil saat input salah.

### Sprint 2 — Scan AI: Backend (12 poin)

**Goal:** `POST /scan` end-to-end: foto → LLM → JSON tervalidasi → tersimpan.

| Story | Poin | Catatan |
|---|---|---|
| Endpoint scan: upload → LLM → simpan (retry, fallback, timeout) | 5 | `llm_raw`, `llm_meta` terekam (PRD §5.3) |
| Prompt engineering + validasi schema (Pydantic) | 3 | `{item_name, category, advice, quote, points}` |
| LLM provider adapter + **mock mode** untuk dev/test | 1 | Biaya nol saat development; model via env |
| Cache Redis per item | 1 | Target hit rate ≥70% (PRD §8) |
| Rate limit scan/user/hari | 1 | Nilai dari keputusan §2.1 |
| Point ledger service (append-only + sync cache) | 1 | PRD §5.10 keputusan #1 |

**Demo:** Curl/HTTP file → respons JSON valid; mock mode & cache terbukti di log.

### Sprint 3 — Scan AI: Mobile (12 poin)

**Goal:** Scan pertama selesai di perangkat — fitur signature jalan penuh.

| Story | Poin | Acuan Desain |
|---|---|---|
| UI scan: camera-preview + overlay frame + sheet hasil (stagger, flash, permission, error) | 5 | `mobile/scan.html` (signature — polish 1:1) |
| Riwayat scan + filter kategori | 1 | Menu "Riwayat" `beranda.html` |
| Integrasi poin scan → ledger + batas harian | 3 | Sheet hasil: chip "+N Poin" |
| Consent + storage foto (privasi PRD §9) | 1 | Untuk scan & persiapan bukti misi |
| Uji lapangan scan di perangkat (latency, kualitas foto) | 1 | Target: hasil <2 detik dgn cache |
| Admin: dashboard shell + KPI cards (data read-only) | 1 | `admin/index.html` |

**Gate:** Metrik aktivasi (PRD §8) mulai diinstrument: event `scan_pertama`.

### Sprint 4 — Misi: Klaim & Data (12 poin)

**Goal:** Misi bisa dibuat admin dan diklaim user (photo & manual & auto_scan menyusul).

| Story | Poin | Acuan Desain |
|---|---|---|
| CRUD misi (admin): periode, poin, mode verifikasi | 3 | Pola form `admin/` (panel + input token) |
| Klaim misi photo: upload bukti → antrian (`user_missions`) | 3 | Consent di layar unggah (PRD §9) |
| UI daftar misi mobile + tab harian/pencapaian | 3 | `mobile/misi.html` |
| Anti dobel klaim + periode (constraint DB) | 1 | `UNIQUE(user_id, mission_id, period_date)` |
| Admin: tabel user + filter + badge role | 1 | `admin/pengguna.html` |
| Admin: dashboard 2 chart (scan harian, kategori) | 1 | SVG inline gaya editorial — port ke lib chart admin |

**Demo:** Klaim bukti dari perangkat → baris muncul di antrian admin.

### Sprint 5 — Misi: Verifikasi & Streak (12 poin)

**Goal:** Loop misi tertutup: klaim → verifikasi → poin + notifikasi; streak berjalan.

| Story | Poin | Acuan Desain |
|---|---|---|
| Antrian verifikasi admin (preview besar, A/R keyboard, catatan wajib saat tolak) | 3 | `admin/verifikasi.html` |
| Notif hasil verifikasi (in-app; push menyusul Sprint 6) | 1 | Status chip "Menunggu/Selesai" `misi.html` |
| Misi auto_scan (progres dari scan, `progress_count`) | 3 | Kartu progres 2/3 di `misi.html` |
| Misi manual (auto-approve saat klaim) | 1 | Tombol "Klaim Poin" |
| Level engine (hitung dari poin) | 1 | Level badge header `beranda.html` |
| Streak harian (reset, bonus) | 3 | Streak card + kalender hari `beranda.html` |

### Sprint 6 — Gamifikasi & Home (12 poin)

**Goal:** Beranda lengkap sesuai mockup; badge & leaderboard hidup; FCM dasar.

| Story | Poin | Acuan Desain |
|---|---|---|
| Badge engine (kriteria JSONB → evaluasi event) | 3 | Grid lencana `misi.html` tab Pencapaian |
| Leaderboard MVP (index `users.points`) | 1 | — (UI penuh fase 2) |
| UI profil: statistik dampak, lencana, poin | 3 | Kartu dampak/pohon `beranda.html` |
| Home assembly final (header melengkung, kutipan harian, menu, FAB, bottom nav) | 3 | `mobile/beranda.html` |
| FCM setup + simpan token (`fcm_tokens`) | 1 | — |
| Konten harian: CRUD + penjadwalan (admin) | 1 | `daily_contents` PRD §5.6 |

**Demo:** Beranda identik mockup dgn data nyata; badge muncul otomatis setelah aksi.

### Sprint 7 — E-Learning & Konten Harian (12 poin)

**Goal:** User bisa belajar modul → kuis → dapat poin; konten harian tayang terjadwal.

| Story | Poin | Acuan Desain |
|---|---|---|
| Admin: CRUD modul + editor blok lesson (JSONB) + bank soal | 3 | Blok paragraph/quote/tip `mobile/elearning.html` |
| Mobile: list + detail modul + pelajaran (blok konten) | 3 | `mobile/elearning.html` |
| Kuis: pengerjaan, penilaian otomatis, poin jika lulus | 3 | View kuis + ring hasil |
| Progress tracking (`user_module_progress`) | 1 | Bar progres kartu modul |
| Mobile: konten harian (wisdom card + refleksi) | 1 | `beranda.html` / `elearning.html` |
| Polish onboarding + splash final | 1 | `onboarding.html` |

### Sprint 8 — Notifikasi, QA, Rilis (15 poin — stabilisasi, tanpa fitur baru)

**Goal:** MVP rilis ke internal testing Play Store.

| Story | Poin | Catatan |
|---|---|---|
| Notif event: streak reminder, misi approve, misi baru | 3 | FCM + `notifications` |
| Admin: composer push (semua/segmen) | 3 | Role admin saja; audit log |
| QA cross-device Android (matrix vendor/ukuran 360–480px) | 3 | Regresi semua layar vs mockup |
| Hardening: rate limit global, security header, Sentry, analytics event lengkap | 3 | Persiapan metrik PRD §8 |
| Rilis Play Store (internal testing) + release notes | 3 | Deklarasi izin kamera/AI (PRD §9) |

---

## 5. Strategi Teknis Pendukung

### 5.1 Arsitektur & kontrak

- **LLM via backend saja** (PRD §4): adapter `LLMProvider` → `MockProvider` (Sprint 2) &
  provider vision asli; model/config via env, fallback model kedua.
- Kontrak API: OpenAPI otomatis (FastAPI); admin & mobile konsumsi via generated client.
- Monorepo: `api/` (FastAPI), `admin/` (Vue3+Vite), `mobile/` (Vue3+Capacitor) — share style: each
  `src/styles/tokens.css` disalin dari `docs/desain/tokens.css` (satu sumber di docs, disalin saat
  perubahan token, dicatat di PR).

### 5.2 QA & lingkungan

| Lingkungan | Kegunaan |
|---|---|
| Local (docker-compose) | Dev harian; LLM mock mode |
| Staging (Railway/Fly) | Uji integrasi LLM asli + FCM; demo review |
| Prod | Setelah Sprint 8 (internal testing) |

Test plan: unit (BE pytest ≥70%), component (Vitest), E2E alur kritis — auth, scan→poin,
klaim→verifikasi→poin, kuis→lulus; manual device matrix (Android 10–14, layar 360/390/430px,
low-end RAM 2GB).

### 5.3 Metrik & instrumentasi (PRD §8)

Event wajib sejak Sprint 3: `scan_pertama` (aktivasi), `misi_selesai`, `modul_selesai`,
`streak_hari`. Dashboard admin menampilkan biaya LLM & cache hit rate sejak Sprint 4.

---

## 6. Risiko & Mitigasi (dev)

| Risiko | Mitigasi |
|---|---|
| Plugin `camera-preview` tidak konsisten antar vendor Android | QA matrix awal Sprint 3; fallback `@capacitor/camera` (ambil foto statis) |
| Latency LLM tinggi → UX buruk | Cache Redis, optimistic UI, skeleton "Menganalisis…", timeout + retry model fallback |
| Biaya LLM selama dev | Mock mode default; provider asli hanya di staging/prod; rate limit ketat |
| Scope creep komunitas/peta (F2) | Ditulis eksplisit di backlog Fase 2; tombol "Segera" di navigasi (sesuai mockup) |
| Play Store menolak (izin kamera/AI) | Deklarasi izin + kebijakan konten AI disiapkan Sprint 8; consent sudah dibangun Sprint 3–4 |

---

## 7. Lampiran — Peta Mockup → Implementasi

| Mockup (`docs/desain/`) | Target implementasi | Sprint |
|---|---|---|
| `tokens.css`, `DESIGN.md` | `mobile/src/styles/tokens.css`, `admin/src/styles/tokens.css` + komponen | 0 |
| `mobile/onboarding.html` | `mobile/src/views/Onboarding.vue` | 1, 7 |
| `mobile/auth.html` | `mobile/src/views/Auth.vue` | 1 |
| `mobile/beranda.html` | `mobile/src/views/Home.vue` (+ komponen StreakCard, ImpactCard, WisdomCard, MenuGrid, BottomNav+Fab) | 3–6 |
| `mobile/scan.html` | `mobile/src/views/Scan.vue` (overlay, sheet hasil, permission, error) | 3 |
| `mobile/misi.html` | `mobile/src/views/Missions.vue` (MisiCard ×4 status, BadgeGrid) | 4–5 |
| `mobile/elearning.html` | `mobile/src/views/Elearning/*` (ModuleList, Lesson, Quiz, Result) | 7 |
| `admin/index.html` | `admin/src/layouts/AdminShell.vue` + `views/Dashboard.vue` (KpiCard, ChartLine, ChartBar) | 0, 3–4 |
| `admin/pengguna.html` | `admin/src/views/Users.vue` (DataTable responsif, FilterChips) | 4 |
| `admin/verifikasi.html` | `admin/src/views/Verification.vue` (VerifStage, QueueStrip, hotkey A/R) | 5 |
| `AUDIT.md` | Checklist a11y/polish wajib pada tiap story UI | semua |

---

*Rencana ini direviu tiap Sprint Review; pergeseran scope dicatat sebagai perubahan backlog, bukan
perubahan definisi MVP tanpa persetujuan PO.*
