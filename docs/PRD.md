# PRD — Ekoteologi AR

> Aplikasi edukasi lingkungan berbasis ekoteologi (teologi + ekologi) dengan gamifikasi dan AI scan sampah.
>
> Status: Draft v1.0 — hasil brainstorming
> Target rilis MVP: sesuai scope, tim scrum lengkap

---

## 1. Ringkasan Produk

**Nama:** Ekoteologi AR

**Masalah:** Masyarakat umum kurang termotivasi memilah sampah karena tidak ada edukasi yang menarik, tidak ada insentif, dan aksi lingkungan terasa terpisah dari nilai spiritual.

**Solusi:** Aplikasi mobile yang menggabungkan:
1. **AI Scan Sampah** — foto sampah → LLM vision mengenali jenis, memberi saran pembuangan + kutipan ayat/hadis terkait.
2. **Gamifikasi** — poin, level, misi harian, lencana, streak.
3. **E-Learning** — modul fiqih lingkungan, kuis.
4. **Komunitas & Peta** — posting kegiatan, titik bank sampah/TPS/event.

**AR (prinsip produk):** Tidak ada AR engine (ARCore/ARKit). Efek "AR" disimulasikan: preview kamera live di layar + overlay frame scan via CSS; hasil klasifikasi LLM muncul sebagai panel "AR" beranimasi. Murah, tidak butuh ARCore.

**Target pengguna:** **Umum** (bukan terbatas santri/pesantren/sekolah), Indonesia, bahasa Indonesia.

**Platform MVP:** **Android only.** iOS menyusul (Capacitor build ulang saja).

---

## 2. Fitur User App

### 2.1 Fondasi
| Fitur | Keterangan |
|---|---|
| Autentikasi | Registrasi/login email + password, Google Sign-In, OTP via WA/SMS (opsional). JWT refresh token. |
| Profil | Nama, avatar, kota, statistik dampak personal. |
| Notifikasi push | FCM. Streak reminder, misi baru, event, approve/reject misi. |
| PWA/Offline | Cache dasar (halaman + data terakhir) untuk area sinyal lemah. |

### 2.2 Scan + AI (fitur unggulan)
- Preview kamera live (`@capacitor-community/camera-preview`) + overlay animasi scan.
- Kirim foto → FastAPI → LLM vision → hasil JSON:
  `{item_name, category, advice, quote, points}`.
- Simpan riwayat scan per user.
- Poin otomatis masuk per scan (dengan batas harian).
- Cache hasil LLM per jenis item (Redis) — instan & hemat biaya.
- Rate limit per user/hari (nilai ditentukan setelah konfirmasi budget LLM).

### 2.3 Misi & Aksi Nyata
- Misi harian/mingguan/spesial dengan reward poin.
- 3 mode verifikasi:
  - `photo` — upload foto bukti, direview manual admin.
  - `auto_scan` — otomatis tercapai lewat scan (mis. "Scan 3 jenis sampah"), progres `progress_count`.
  - `manual` — auto-approve saat klaim (mis. "Baca artikel").
- Anti klaim dobel via constraint DB.

### 2.4 E-Learning
- Modul → pelajaran → kuis.
- Progress tersimpan; kuis dinilai otomatis; poin jika lulus.
- Konten JSONB blocks (paragraph/quote/tip) — mudah dirender & diedit admin.

### 2.5 Gamifikasi
- Poin (ledger append-only), level berdasar poin, lencana (badge) otomatis dari kriteria, streak harian.
- Leaderboard mingguan/bulanan (MVP: index `users.points`; fase 2: tabel agregat).

### 2.6 Konten Harian Ekoteologi
- Ayat/hadis/refleksi harian + aksi nyata terkait (dikelola admin, dijadwalkan per tanggal).

### 2.7 Komunitas & Peta (Fase 2, opsional MVP)
- Posting kegiatan + foto + lokasi, like/komentar, laporan moderasi.
- Peta titik bank sampah/TPS/event (Leaflet/OpenStreetMap — gratis).

### 2.8 Reward / Redeem (Fase 2)
- Katalog hadiah, tukar poin, alur approval admin.

---

## 3. Halaman Admin

Admin panel web (Vue 3). Role: `admin`, `verifier`, `editor`.

| Modul | Isi |
|---|---|
| Dashboard | Statistik user aktif, total scan, retensi, misi terpopuler, biaya LLM. |
| Manajemen User | Cari, detail, blokir/unblokir, reset poin, ubah role. |
| Verifikasi Misi | Antrian bukti foto → approve/reject + catatan. |
| Konten E-Learning | CRUD modul, pelajaran, bank soal kuis. |
| Manajemen Misi | CRUD misi, periode, poin, mode verifikasi. |
| Konten Harian | CRUD & penjadwalan ayat/hadis/refleksi. |
| Manajemen Reward *(F2)* | Katalog hadiah, stok, approval redeem. |
| Moderasi Komunitas *(F2)* | Post/komentar: hide/delete, kelola laporan. |
| Peta *(F2)* | CRUD titik bank sampah, TPS, event. |
| Push Notification | Composer + targeting (semua / segmen). |
| Role & Audit | Manajemen role, log aktivitas admin. |
| Laporan | Export CSV/PDF. |

---

## 4. Tech Stack

| Komponen | Teknologi | Catatan |
|---|---|---|
| Database | **PostgreSQL** | JSONB utk konten fleksibel. |
| Backend | **FastAPI (Python)** | SDK LLM Python paling matang; async; Pydantic. |
| LLM | **Provider vision (mis. GLM-4.5-Flash / GLM-4.6V)** | API OpenAI-compatible. **Konfigurasi via env — model mudah ditukar.** Tidak hardcode. |
| Cache | Redis | Cache hasil LLM, rate limit, session. |
| Admin Frontend | **Vue 3 + Vite** + UI lib (Naive UI / Element Plus / shadcn-vue) | SPA. |
| Mobile | **Vue 3 + Capacitor (Android)** | Plugin: `@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/push-notifications`, `@capacitor-community/camera-preview`. |
| Push | FCM | |
| Peta | Leaflet + OpenStreetMap | Gratis. |
| Deploy | VPS / Railway / Fly.io | API + admin satu server; Alembic migrasi. |

**Kenapa Vue+Capacitor, bukan Flutter:** tidak ada kebutuhan native berat (AR disimulasikan). Kamera/geolokasi/push tersedia sebagai plugin Capacitor. Satu skillset (Vue) untuk mobile + admin. Prototipe HTML/CSS existing dapat diadaptasi.

**Prinsip arsitektur LLM:** App **tidak pernah** memanggil LLM langsung. Semua via FastAPI: API key aman, rate limit per user, caching, logging (`llm_raw`, `llm_meta`), fallback model.

---

## 5. Skema Database (PostgreSQL)

> Migration via Alembic. Poin: ledger append-only = sumber kebenaran; `users.points` hanya cache.

```
users ──┬─ point_transactions   (ledger poin)
        ├─ scans ─────────────── waste_categories
        ├─ user_missions ─────── missions
        ├─ user_module_progress ─ modules ── lessons
        ├─ user_quiz_attempts ─── quizzes ── quiz_questions
        ├─ user_badges ────────── badges
        ├─ posts ── post_comments / post_likes / reports
        ├─ notifications
        └─ redemptions ────────── rewards   [fase 2]
```

### 5.1 User & Auth
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE,
  phone         VARCHAR(20)  UNIQUE,
  password_hash TEXT,
  full_name     VARCHAR(100) NOT NULL,
  avatar_url    TEXT,
  role          VARCHAR(20) DEFAULT 'user',   -- user|verifier|editor|admin
  points        INT DEFAULT 0,                -- CACHE, jangan update langsung
  city          VARCHAR(100),
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_active_date DATE,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE fcm_tokens (
  id       BIGSERIAL PRIMARY KEY,
  user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  token    TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE levels (
  level     INT PRIMARY KEY,
  min_points INT NOT NULL,
  title     VARCHAR(50) NOT NULL
);
```

### 5.2 Gamifikasi
```sql
CREATE TABLE point_transactions (
  id        BIGSERIAL PRIMARY KEY,
  user_id   UUID REFERENCES users(id),
  amount    INT NOT NULL,
  source    VARCHAR(20) NOT NULL,    -- scan|mission|quiz|streak|redeem|adjustment
  ref_id    BIGINT,
  note      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE badges (
  id SERIAL PRIMARY KEY,
  code        VARCHAR(50) UNIQUE,
  name        VARCHAR(100),
  icon        VARCHAR(100),
  description TEXT,
  criteria    JSONB              -- {"type":"scan_count","value":50}
);
CREATE TABLE user_badges (
  user_id   UUID REFERENCES users(id),
  badge_id  INT REFERENCES badges(id),
  earned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);
```

### 5.3 Scan + LLM
```sql
CREATE TABLE waste_categories (
  id      SERIAL PRIMARY KEY,
  name    VARCHAR(50) NOT NULL,   -- Organik|Plastik|B3|Residu
  icon    VARCHAR(50),
  base_points INT DEFAULT 5
);

CREATE TABLE scans (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id),
  image_url   TEXT,
  item_name   VARCHAR(100),
  category_id INT REFERENCES waste_categories(id),
  advice      TEXT,
  quote       JSONB,               -- {text, source}
  llm_raw     JSONB,               -- respon mentah (audit & debug)
  llm_meta    JSONB,              -- {model, latency_ms, tokens}
  points      INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 5.4 Misi
```sql
CREATE TABLE missions (
  id           SERIAL PRIMARY KEY,
  title        VARCHAR(150) NOT NULL,
  description  TEXT,
  type         VARCHAR(20) DEFAULT 'daily',
  icon         VARCHAR(100),
  points       INT NOT NULL,
  verification VARCHAR(20) NOT NULL,              -- photo|auto_scan|manual
  scan_category_id INT REFERENCES waste_categories(id),
  required_count   INT DEFAULT 1,
  start_at     TIMESTAMPTZ, end_at TIMESTAMPTZ,
  is_active    BOOLEAN DEFAULT true
);

CREATE TABLE user_missions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id),
  mission_id   INT REFERENCES missions(id),
  period_date  DATE,
  status       VARCHAR(20) DEFAULT 'in_progress',
  progress_count INT DEFAULT 0,
  proof_image_url TEXT,
  note         TEXT,
  reviewed_by  UUID REFERENCES users(id),
  review_note  TEXT,
  points_awarded INT DEFAULT 0,
  started_at   TIMESTAMPTZ DEFAULT now(),
  submitted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ,
  UNIQUE (user_id, mission_id, period_date)
);
```

### 5.5 E-Learning
```sql
CREATE TABLE modules (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  slug  VARCHAR(200) UNIQUE,
  description TEXT, cover_url TEXT,
  "order" INT DEFAULT 0,
  is_published BOOLEAN DEFAULT false
);

CREATE TABLE lessons (
  id BIGSERIAL PRIMARY KEY,
  module_id INT REFERENCES modules(id) ON DELETE CASCADE,
  title VARCHAR(200),
  content JSONB,
  "order" INT DEFAULT 0
);

CREATE TABLE quizzes (
  id SERIAL PRIMARY KEY,
  module_id INT REFERENCES modules(id)
);
CREATE TABLE quiz_questions (
  id SERIAL PRIMARY KEY,
  quiz_id INT REFERENCES quizzes(id),
  question TEXT,
  options JSONB,
  answer  INT,
  explanation TEXT,
  "order" INT DEFAULT 0
);

CREATE TABLE user_module_progress (
  user_id UUID REFERENCES users(id),
  module_id INT REFERENCES modules(id),
  lessons_done INT DEFAULT 0,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, module_id)
);

CREATE TABLE user_quiz_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id), quiz_id INT REFERENCES quizzes(id),
  score INT, total INT, answers JSONB,
  points_awarded INT DEFAULT 0,
  passed BOOLEAN,
  attempted_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.6 Konten Harian
```sql
CREATE TABLE daily_contents (
  id SERIAL PRIMARY KEY,
  publish_date DATE UNIQUE,
  type VARCHAR(20),                -- ayat|hadis|refleksi
  title VARCHAR(200), body TEXT,
  source VARCHAR(100),
  eco_action TEXT,
  image_url TEXT
);
```

### 5.7 Komunitas & Peta [Fase 2]
```sql
CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  caption TEXT, image_url TEXT,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  like_count INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'published',  -- published|hidden
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE post_likes (
  user_id UUID REFERENCES users(id), post_id BIGINT REFERENCES posts(id),
  PRIMARY KEY (user_id, post_id)
);
CREATE TABLE post_comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT REFERENCES posts(id),
  user_id UUID REFERENCES users(id), body TEXT,
  deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE reports (
  id BIGSERIAL PRIMARY KEY,
  reporter_id UUID REFERENCES users(id),
  target_type VARCHAR(20),             -- post|comment|user
  target_id BIGINT,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE map_locations (
  id SERIAL PRIMARY KEY,
  type VARCHAR(30),                    -- bank_sampah|tps|event
  name VARCHAR(150), description TEXT,
  lat DECIMAL(10,7), lng DECIMAL(10,7),
  address TEXT,
  start_at TIMESTAMPTZ, end_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  is_verified BOOLEAN DEFAULT true
);
```

### 5.8 Reward [Fase 2]
```sql
CREATE TABLE rewards (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150), image_url TEXT,
  points_cost INT, stock INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);
CREATE TABLE redemptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id), reward_id INT REFERENCES rewards(id),
  points_spent INT,
  status VARCHAR(20) DEFAULT 'requested',
  processed_by UUID REFERENCES users(id), processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.9 Notifikasi, Audit, Setting
```sql
CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),  -- NULL = broadcast
  title VARCHAR(200), body TEXT,
  type VARCHAR(30),                    -- mission|streak|info|reward
  payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id),
  action VARCHAR(50),
  entity VARCHAR(30), entity_id TEXT,
  diff JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE app_settings (key VARCHAR(50) PRIMARY KEY, value JSONB);
```

### 5.10 Keputusan Desain
1. **Poin double-entry:** `point_transactions` append-only sumber kebenaran; `users.points` cache di-sync service layer; bisa direkonsiliasi; adjustment admin tercatat.
2. **Level tidak disimpan** — dihitung dari `levels.min_points` saat poin berubah.
3. **`UNIQUE(user_id, mission_id, period_date)`** mencegah klaim dobel.
4. **JSONB** untuk LLM raw/meta, blok lesson, opsi kuis, kriteria badge.
5. **Soft delete** posts/comments (`deleted_at`).
6. **Cache LLM** per item di Redis (90% item = sampah umum) — hemat biaya, respons instan.
7. **Leaderboard** MVP: index `users(points DESC)`; fase 2: agregat + cron.
8. **Tanpa RLS** — otorisasi di FastAPI service layer + `users.role`.

---

## 6. MVP Boundary (proposal)

**MVP (rilis pertama):**
- Auth + profil
- Dashboard (home)
- Scan + LLM (AR simulasi)
- Misi + verifikasi (photo & auto_scan)
- E-Learning dasar (modul + kuis)
- Konten harian
- Notifikasi push
- Admin: dashboard, user, verifikasi misi, misi, e-learning, konten harian, push, audit, laporan

**Fase 2:**
- Leaderboard & kompetisi antar komunitas
- Forum/komunitas (posting, like, komentar, moderasi)
- Peta (bank sampah, TPS, event)
- Reward/redeem
- PWA offline penuh

**Keputusan terbuka (perlu konfirmasi sebelum dev):**
1. Scope respons LLM scan: klasifikasi saja vs + saran aksi + quote.
2. Budget LLM → rate limit scan/user/hari.
3. Bahasa: Indonesia saja? *(dianggap ya)*
4. Reward MVP: digital saja? *(dianggap ya — fisik fase 2)*
5. Hosting: VPS vs managed (Railway/Fly.io).
6. Privasi: consent foto bukti misi (bisa memuat wajah) + kebijakan retensi/penghapusan.
7. Verifikasi misi: manual admin vs auto-approve per tipe misi. *(dianggap: sesuai kolom `missions.verification`)*

---

## 7. Epics & Stories (draft sprint planning)

Estimasi relatif: S kecil, M sedang, L besar. Urutan = urutan sprint yang disarankan.

### Epic 1 — Fondasi (Sprint 0–1)
| Story | Poin | Keterangan |
|---|---|---|
| Setup repo monorepo (api/, admin/, mobile/) + CI | M | Lint, test, build pipeline. |
| Setup FastAPI + Alembic + PostgreSQL + Redis | M | Struktur project, konfigurasi env. |
| Auth: registrasi/login email, JWT refresh | M | + rate limit login. |
| Auth: Google Sign-In | S | via Capacitor plugin. |
| Mobile scaffold: Vue + Capacitor, build APK debug | M | Halaman onboarding → login → home. |
| Admin scaffold: Vue + Vite + UI lib + layout | S | Login admin + role guard. |
| Audit log middleware | S | |

### Epic 2 — Scan + AI (Sprint 2–3)
| Story | Poin | Keterangan |
|---|---|---|
| Endpoint scan: upload foto → LLM → simpan | L | Termasuk retry, fallback model, timeout. |
| Prompt engineering + schema validasi respons | M | Pydantic; `{item_name, category, advice, quote, points}`. |
| Cache Redis per item | S | |
| Rate limit per user/hari | S | |
| UI scan: kamera preview + overlay "AR" + hasil panel | L | Plugin camera-preview. |
| Riwayat scan | S | |
| Integrasi poin otomatis + ledger | M | |

### Epic 3 — Misi (Sprint 3–4)
| Story | Poin | Keterangan |
|---|---|---|
| CRUD misi (admin) | M | |
| Klaim misi: photo → antrian verifikasi | M | Upload ke storage. |
| Verifikasi admin: approve/reject + notif hasil | M | |
| Misi auto_scan (progres dari scan) | M | |
| Misi manual (auto-approve) | S | |
| Anti dobel klaim + periode harian/mingguan | S | Constraint DB. |
| UI daftar misi + tab harian/pencapaian | M | |

### Epic 4 — Gamifikasi (Sprint 4–5)
| Story | Poin | Keterangan |
|---|---|---|
| Level engine (hitung dari poin) | S | |
| Badge engine (kriteria JSONB → evaluate event) | M | |
| Streak harian (reset, bonus) | M | |
| Leaderboard (MVP index) | S | |
| UI profil: dampak personal, lencana | M | |

### Epic 5 — E-Learning (Sprint 5–6)
| Story | Poin | Keterangan |
|---|---|---|
| CRUD modul/lesson/kuis (admin) | M | Editor blok JSONB. |
| List + detail modul (mobile) | M | |
| Kuis + penilaian otomatis + poin | M | |
| Progress tracking | S | |
| Konten harian: CRUD + jadwal (admin) | S | |
| Konten harian: tampilan mobile | S | |

### Epic 6 — Notifikasi & Polish (Sprint 6–7)
| Story | Poin | Keterangan |
|---|---|---|
| FCM setup + simpan token | S | |
| Notif event: streak, misi approve, misi baru | M | |
| Admin composer push (semua/segmen) | M | |
| Onboarding + splash final | S | |
| QA cross-device Android | M | |
| Hardening: rate limit global, security header, error tracking (Sentry) | M | |
| Release ke Play Store (internal testing) | M | |

### Epic 7 — Fase 2 (backlog, tidak di MVP)
- Leaderboard agregat bulanan, kompetisi antar komunitas.
- Forum/komunitas + moderasi + laporan.
- Peta (Leaflet) + CRUD lokasi.
- Reward/redeem + approval.
- PWA offline penuh.

---

## 8. Metrik Keberhasilan (proposal)

- Aktivasi: ≥40% user baru menyelesaikan scan pertama dalam 24 jam.
- Retensi D7 ≥ 20%; streak rata-rata ≥ 3 hari.
- Misi: ≥50% user aktif menyelesaikan ≥1 misi/minggu.
- E-learning: ≥30% user menyelesaikan ≥1 modul.
- Biaya LLM/user/bulan dalam budget; cache hit rate ≥70%.

---

## 9. Risiko

| Risiko | Mitigasi |
|---|---|
| Biaya LLM membengkak | Cache Redis, rate limit harian, model flash murah, fallback. |
| Hasil LLM tidak akurat/halusinasi quote | Validasi schema ketat; bank quote terkurasi yang dicocokkan via keyword, bukan digenerasi LLM. |
| Foto bukti misi memuat wajah | Consent saat upload; retensi & hapus atas permintaan. |
| Spam/poin farming (scan foto sama berulang) | Rate limit, hash foto, cooldown per kategori, badge review anomali di admin. |
| Play Store policy (kamera, AI content) | Deklarasi izin jelas; kebijakan konten AI. |

---

*PRD ini akan diperbarui sebelum sprint 0. Keputusan terbuka di §6 harus ditutup lebih dulu.*
