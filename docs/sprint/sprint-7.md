# Laporan Sprint 7 — E-Learning & Konten Harian

> Periode: 5 September 2026 · Kapasitas: 12 poin · Status: **selesai — 6/6 story diterima
> (12/12 poin)** · Goal sprint: **User bisa belajar modul → kuis → dapat poin; konten
> harian tayang terjadwal.**

---

## 1. Ringkasan

Menu **Belajar** kini hidup ujung-ke-ujung. Peserta membuka layar E-Learning (`elearning.html`)
yang menampilkan chip **"1/3 modul"**, kartu **"Refleksi Hari Ini"** (konten harian — endpoint
yang sama dengan kartu kutipan beranda, satu sumber), dan kartu-kartu modul dengan bar progres
nyata serta CTA yang ditentukan server (**Mulai / Lanjutkan / Ulangi**). Di dalam modul: daftar
pelajaran dengan centang hijau, pembaca blok konten **paragraph / quote (teks Arab + terjemahan
+ sumber) / tip** persis mockup, tombol **"Tandai Selesai & Lanjut"**, dan kartu **Kuis Modul**.
Kuis dinilai **otomatis di server** — kunci jawaban tidak pernah dikirim sebelum submit; lulus
(≥70%) membawa **+20 poin lewat ledger append-only sekali per modul**, notifikasi "Poin kuis
masuk", event `modul_selesai`, streak berdetak, dan evaluasi lencana on-event; layar hasil
menampilkan **ring skor conic-gradient** plus Bedah Jawaban (kunci + penjelasan).

Di sisi admin, modul **E-Learning** (`/e-learning`) menyediakan **CRUD modul + editor blok
pelajaran JSONB + bank soal**: editor blok mendukung Paragraf/Kutipan/Tip dengan urutan naik-
turun, bank soal memvalidasi pilihan & kunci jawaban, dan kuis per modul dibuat otomatis saat
soal pertama ditambahkan. Modul yang sudah dikerjakan peserta dilindungi dari penghapusan (409).
Seed kini memuat **3 modul contoh** mengikuti mockup sehingga demo belajar → kuis → poin jalan
tanpa isi data manual. Story **polish onboarding + splash** ditutup: splash menunggu font siap
(dengan batas waktu), navigasi slide mendapat swipe + panah keyboard, dan perpindahan slide
diumumkan via `aria-live`.

Bukti cepat (kriteria demo Sprint 7):

| Kriteria demo | Hasil |
|---|---|
| User bisa belajar modul → kuis → dapat poin | ✅ Smoke E2E 13 langkah: pelajaran 1 → progres 50% → pelajaran 2 → modul tuntas (event `modul_selesai` source=pelajaran + streak) → kuis gagal 1/4 (0 poin) → kuis lulus 4/4 (**+20 poin**, ledger `quiz`, notif, event source=kuis, streak 1) → kuis ulang lulus lagi = **0 poin** (anti dobel) → chip "1/3 modul" + kartu "Selesai · Ulangi" |
| Konten harian tayang terjadwal | ✅ Hari tanpa jadwal → fallback bank quote (`fallback: true`); admin menjadwalkan refleksi hari ini → `GET /v1/daily-content` menampilkan konten + "Aksi hari ini"; layar Belajar memakai endpoint yang sama (kartu "Refleksi Hari Ini") |
| Admin CRUD modul + blok + bank soal | ✅ Smoke: `POST /v1/admin/modules` slug otomatis (`modul-smoke-7`) → tambah pelajaran blok tip → tambah soal (kuis lazy) → opsi 1 terisi ditolak (422) → `DELETE` modul dengan progres → **409** |
| CI hijau | ✅ run #17 pada `1b7f262` (commit fitur + laporan satu push) — 4/4 job hijau (api, admin, mobile, android-apk) — detail §4 |

---

## 2. Status Story

| Story | Poin | Status | Catatan |
|---|---|---|---|
| Admin: CRUD modul + editor blok lesson (JSONB) + bank soal | 3 | ✅ | `GET/POST/PATCH/DELETE /v1/admin/modules`, `GET/POST /v1/admin/modules/{id}/lessons` + `PATCH/DELETE /v1/admin/lessons/{id}`, `GET/POST /v1/admin/modules/{id}/questions` + `PATCH/DELETE /v1/admin/questions/{id}`. `ModulesView.vue` (`/e-learning`, masuk sidebar): tabel modul (rekap pelajaran/soal, badge Tayang/Draft), form panel, **panel Kelola** dua kolom — editor blok (Paragraf/Kutipan arab+terjemah+sumber/Tip; naik/turun/hapus) & bank soal (4 pilihan + radio kunci + penjelasan). Tulis admin·editor, hapus admin; hapus modul dgn progres → 409. Blok tervalidasi `normalize_blocks()` (pesan "Blok #N") di dua lapis |
| Mobile: list + detail modul + pelajaran (blok konten) | 3 | ✅ | `Elearning/ModuleListView.vue` (`/belajar`, tab bottom-nav "Belajar" kini aktif; kartu menu beranda bukan lagi "Segera hadir") + `ModuleDetailView.vue` (daftar pelajaran + kartu kuis dgn hasil terbaik) + `LessonView.vue` (blok JSONB 1:1 mockup; "Tandai Selesai & Lanjut"; "Lompat ke Kuis"). State skeleton/empty/error lengkap; bar progres `role=progressbar`; ikon dari `cover_url` (ikon FontAwesome seed atau URL gambar) |
| Kuis: pengerjaan, penilaian otomatis, poin jika lulus | 3 | ✅ | `QuizView.vue` (intro "4 soal · lulus 70% · hadiah +20 poin" → satu soal per layar dgn titik progres → kirim) + `ResultView.vue` (ring `--val` conic-gradient, Bedah Jawaban kunci+penjelasan). `POST /v1/modules/{id}/quiz`: penilaian murni `grade_quiz()` + ambang env; lulus → poin sekali per modul via `award_points(source="quiz")` + notif + event + streak + badge on-event; kunci tidak pernah bocor pra-submit |
| Progress tracking (`user_module_progress`) | 1 | ✅ | Progres **berurutan**: `lessons_done = max(tercatat, order+1)` — baca ulang tidak menurunkan/menggandakan. Pelajaran terakhir → `is_completed` + `completed_at`, event `modul_selesai` + streak + badge (sekali, transisi idempoten). Persen & CTA dihitung server (`progress_percent`, `module_cta`) — satu sumber untuk kartu modul |
| Mobile: konten harian (wisdom card + refleksi) | 1 | ✅ | WisdomCard mendapat prop `label`: beranda "Kutipan Hari Ini", Belajar **"Refleksi Hari Ini"** (mockup `elearning.html`) — keduanya dari `GET /v1/daily-content` Sprint 6 (jadwal admin atau fallback bank quote), **tanpa duplikasi sumber**; best-effort, tidak memblokir daftar modul |
| Polish onboarding + splash final | 1 | ✅ | `OnboardingView.vue`: splash menunggu `document.fonts.ready` (cap 2,5 dtk) + durasi minimum 1,2 dtk (tanpa FOUT saat slide tampil); navigasi **swipe** ≥48px & **panah keyboard**; pengumuman slide `aria-live=polite`; splash tetap menghormati `prefers-reduced-motion` via tokens.css |

---

## 3. Yang Dibangun

### 3.1 API (`api/`)

- **Endpoint user** (`app/api/elearning.py` baru, prefix `/v1`): `GET /modules` (kartu +
  progres + `summary`), `GET /modules/{id}` (detail: pelajaran, intro kuis tanpa kunci,
  `quiz_best`), `GET /lessons/{id}`, `POST /lessons/{id}/complete`, `GET /modules/{id}/quiz`,
  `POST /modules/{id}/quiz`.
- **Logika murni** (`app/services/elearning.py` baru): `normalize_blocks()` (validasi blok
  JSONB — tipe/teks wajib, quote arab/sumber opsional), `next_lessons_done()`,
  `progress_percent()`, `module_cta()`, `grade_quiz()` + `with_threshold()` (penilaian
  otomatis; soal tak dijawab = salah), `quiz_result_message()`.
- **Skema** (`app/schemas/elearning.py` baru): kartu/detail/lesson/quiz/result + skema admin
  (modul/pelajaran/soal). Kunci jawaban hanya ada di respons admin & review pascasubmit.
- **Endpoint admin** (`app/api/admin_elearning.py` baru): CRUD modul (slug otomatis dari
  judul + suffix anti bentrok; hapus 409 bila ada progres/attempt), CRUD pelajaran per modul
  (blok tervalidasi), CRUD soal (**kuis per modul dibuat lazily** saat soal pertama;
  opsi 2–6 & kunci dalam jangkauan).
- **Gamifikasi tersambung**: poin kuis lewat `award_points(source="quiz")` (ledger — PRD §5.10
  #1); event `modul_selesai` masuk `KNOWN_EVENTS` (`services/metrics.py`) dengan payload
  `source: pelajaran|kuis`; `touch_streak()` dan `sync_user_badges()` on-event di momen
  transisi modul tuntas & kuis pertama kali lulus — engine Sprint 5/6 tidak diubah.
- **Config/env**: `QUIZ_PASS_PERCENT` (70) & `QUIZ_POINTS` (20) — angka mengikuti mockup,
  bisa diubah PO tanpa deploy. **Tanpa migrasi** — tabel e-learning lengkap sejak skema awal
  Sprint 0 (keputusan skema penuh terbayar ketiga kalinya).
- **Seed**: +3 modul contoh (`Eko-Iman: Dasar Ekoteologi`, `Fiqih Sampah Sehari-hari`,
  `Hemat Air, Amal Terjaga` — sesuai mockup) dengan 6 pelajaran & 9 soal; idempoten per
  slug/judul pelajaran/teks soal; blok tervalidasi `normalize_blocks`.
- **Test**: 211 → **237** (26 test baru: penilaian murni 6, progres/CTA 3, daftar & detail 4,
  pelajaran & progres 3, kuis 6 — termasuk anti dobel poin & event/streak di DB, admin 8).

### 3.2 Mobile (`mobile/`)

- **5 view baru** `views/Elearning/`: ModuleList, ModuleDetail, Lesson, Quiz, Result (peta
  plan §7 + satu tambahan wajar: detail modul sebagai pintu daftar pelajaran → kuis). Pola
  state lengkap; BottomNav "Belajar" dan kartu menu beranda kini berpindah layar.
- **Util murni** `utils/elearning.ts` (+15 test vitest): label progres Baru/N%/Selesai,
  CTA, "N pelajaran · kuis", chip "N/M modul", "Pelajaran 2 dari 4", baris intro kuis, titik
  progres, judul/label ring hasil, baris poin 3 keadaan, deteksi cover gambar vs ikon.
- **`stores/quizResult.ts`**: jembatan hasil kuis QuizView → ResultView (detail §5.9);
  refresh di layar hasil kembali ke intro — hasil tidak pernah dibuat-buat.
- **WisdomCard** +prop `label` (default "Kutipan Hari Ini") — dipakai ulang di layar Belajar.
- **Onboarding** polish (§2 story 6).

### 3.3 Admin (`admin/`)

- **`views/ModulesView.vue`** (`/e-learning` + menu sidebar aktif): CRUD modul + **panel
  Kelola** (editor blok & bank soal berdampingan) — detail §2. Editor blok memakai class
  panel/tabel admin yang ada; `<fieldset>` radio kunci jawaban dengan label aria per pilihan.
- **Util murni** `utils/elearning.ts` (+11 test vitest — test admin ke-4): `emptyBlock`,
  `blocksSummary`, `lessonError`, `questionError`, `optionLetter`, `slugPreview`.

### 3.4 Dokumentasi

- README api (kontrak endpoint Sprint 7 + arsitektur e-learning + env + seed), admin (modul
  E-Learning), mobile (Sprint 7), `.env.example`, dan laporan ini.

---

## 4. Verifikasi

| Verifikasi | Metode | Hasil |
|---|---|---|
| pytest | `uv run pytest -q --cov=app --cov-fail-under=70` | ✅ 237 lulus, coverage 76,66% (gate 70%) |
| ruff | `ruff check .` + `format --check` | ✅ bersih |
| Vitest | `npm test` mobile & admin | ✅ mobile 81 lulus (9 file — +15 Sprint 7), admin 25 lulus (+11 util e-learning) |
| eslint + build ketiga app | CI-equivalent lokal | ✅ bersih; `vue-tsc` + vite build sukses ketiganya |
| APK debug | `cap sync android` + `./gradlew assembleDebug` | ✅ BUILD SUCCESSFUL — `app-debug.apk` 9,9 MB; CI juga memproduksinya |
| Smoke E2E Sprint 7 | uvicorn lokal (DB `ekoteologi_smoke` bersih, seed 3 modul, mock LLM) + klien httpx | ✅ 13 langkah: daftar modul (3 seed, chip 0/3) → detail tanpa kunci → pelajaran 1 (50%) → pelajaran 2 (modul tuntas: event source=pelajaran + streak) → kuis gagal 1/4 (0 poin, attempt tersimpan) → kuis lulus 4/4 (+20; profil poin=20 streak=1; event source=kuis; notif "Poin kuis masuk") → kuis ulang (0 poin, `already_passed_before`, 3 attempt total poin tetap 20) → daftar ulang (Selesai/Ulangi, chip 1/3) → fallback konten → admin CRUD (slug otomatis, pelajaran, soal lazy, opsi invalid ditolak) → hapus modul berprogres 409 → konten terjadwal tayang dgn aksi hari ini |
| Anti dobel poin | test + smoke | ✅ 3 attempt: `fail→pass→pass` — total `points_awarded` tetap 20; lulus setelah gagal tetap berhak dapat poin |
| CI GitHub | run #17 (`1b7f262`, push commit fitur + laporan) | ✅ sukses — api (ruff + 237 pytest + coverage gate), admin (lint+vitest+build), mobile (lint+vitest+build), android-apk (4/4 job) |
| Verifikasi browser interaktif & perangkat Android nyata | — | ⚠️ Belum di sesi ini (tool browser & perangkat tidak tersedia — item terbuka sejak Sprint 0); UI ditutup unit/component test + typecheck + build + APK; smoke E2E menutup alur di tingkat API |

---

## 5. Keputusan & Catatan Teknis

1. **Poin kuis = sekali per modul, hanya saat lulus** (keputusan kerja lintas sprint yang
   diminta rencana): attempt pertama yang LULUS membawa `QUIZ_POINTS`; lulus ulang tetap
   tercatat (`passed=true`, `points_awarded=0`, flag `already_passed_before` di respons) tapi
   tanpa poin; gagal tidak membawa poin dan tidak menghalangi poin di percobaan berikutnya.
   Deteksinya query `user_quiz_attempts` `passed=true` milik user+quiz — idempoten bahkan
   untuk request serentak sekalipun dibutuhkan transaksi sama (poin ditulis di transaksi yang
   sama dengan attempt). Ledger tetap satu-satunya sumber kebenaran.
2. **Progres pelajaran berurutan tanpa tabel baru**: skema PRD hanya punya `lessons_done`
   (INT), bukan relasi per-pelajaran — dipakai sebagai penanda "sudah baca sampai pelajaran
   ke-N": `lessons_done = max(tercatat, order+1)`. Membaca lompat ke pelajaran terakhir tetap
   dihitung (jujur menandai selesai), membaca ulang yang lama tidak menurunkan progres.
   Modul dianggap tuntas saat `lessons_done ≥ total` → `is_completed` + `completed_at`.
3. **Event `modul_selesai` dua sumber, masing-masing sekali**: payload `{module_id,
   source: "pelajaran"}` saat transisi modul tuntas via pelajaran, `{..., source: "kuis",
   quiz_id, score}` saat kuis pertama kali lulus. Transisi bersifat idempoten (pelajaran:
   hanya saat `is_completed` berubah; kuis: hanya pada lulus pertama) sehingga tidak ada
   event ganda saat kuis diulang. Streak + badge on-event menempel di dua momen itu —
   konsisten pola "poin masuk = streak berdetak" Sprint 5/6.
4. **Kunci jawaban tidak pernah meninggalkan server sebelum submit** (anti curang): intro
   kuis mengirim `question/options` saja; kunci + penjelasan baru muncul di `review[]`
   respons submit. `quiz_best` untuk kartu kuis dihitung dari attempt terbaik user.
5. **Ambang & hadiah kuis env-driven**: `QUIZ_PASS_PERCENT=70`, `QUIZ_POINTS=20` — angka
   mockup `elearning.html` ("5 soal · lulus 70% · hadiah +20 poin") menjadi default yang
   bisa diubah PO tanpa deploy (pola streak Sprint 5). Intro kuis mengirim angka dari server
   sehingga teks dan logika tak mungkin pisah.
6. **`cover_url` ganda fungsi: URL gambar atau nama ikon FontAwesome** — kolom PRD hanya
   `cover_url` dan seed/mockup memakai `fa-leaf`/`fa-recycle`/`fa-droplet`; alih-alih
   migrasi kolom ikon baru, klien membedakan util `isImageUrl()` (awalan http/data//).
   Dokumentasi admin mengarahkan dua bentuk ini.
7. **Konten harian tidak diduplikasi**: kartu "Refleksi Hari Ini" di layar Belajar memanggil
   endpoint yang sama dengan beranda (`GET /v1/daily-content` — jadwal admin `daily_contents`
   atau fallback bank quote); WisdomCard hanya ditambah prop `label` agar judul kartu sesuai
   masing-masing mockup. Sumber, penjadwalan, dan fallback tetap satu kebenaran.
8. **Hasil kuis diteruskan via store memori, bukan history state**: tipe `HistoryState`
   vue-router menolak objek kompleks (index signature), dan hasil dari server memang tak
   perlu disimpan di URL/history. Konsekuensi disengaja: refresh di layar hasil kembali ke
   intro kuis — aplikasi tidak pernah menayangkan "hasil basi" dari memori mati.
9. **Detail modul = tambahan di luar peta mockup**: plan §7 memetakan ModuleList/Lesson/
   Quiz/Result, sedangkan kartu modul butuh pintu "daftar pelajaran + kartu kuis" (story
   "list + detail modul + pelajaran" memang menyebut detail modul). `ModuleDetailView.vue`
   mengisi celah itu dengan pola visual kartu/bar yang sama; CTA utamanya mengikuti progres
   server.
10. **Admin: kuis dibuat lazily & modul berprogres tak dihapus** — `POST questions` membuat
    baris `quizzes` saat soal pertama (admin tak perlu paham konsep kuis terpisah), dan
    `DELETE module` menolak 409 bila ada `user_module_progress`/attempt (riwayat poin & event
    jangan terputus) — nonaktifkan via draft. Slug modul otomatis dari judul dengan suffix
    `-2` bila bentrok; slug eksplisit bentrok → 409 informatif.
11. **Bug falsy-zero tertangkap test**: helper urutan admin (`max(order)`) hampir memakai
    `current or -1` yang menghasilkan urutan macet di 0 ketika max order memang 0 —
    diganti `current if current is not None else -1` dan dikunci test (`order == 1` untuk
    soal kedua). Pola sama diterapkan di helper pelajaran.
12. **Splash final menunggu kerja nyata**: alih-alih timer kosong, splash menunggu
    `document.fonts.ready` (cap 2,5 dtk agar tak pernah menggantung) + minimum 1,2 dtk —
    menghilangkan FOUT saat slide onboarding tampil. Swipe (≥48px, `passive`) dan panah
    keyboard adalah akselerator; dots + tombol tetap jalur utama (a11y).
13. **Seed modul mengikuti mockup, bukan data baru karangan**: judul, deskripsi, ikon, dan
    isi blok pelajaran "Hukum Memilah Sampah dalam Islam" diambil dari `elearning.html`
    sehingga demo dan desain identik; validasi blok seed memakai `normalize_blocks` yang
    sama dengan editor admin (satu aturan).

---

## 6. DoD Sprint 7 — Checklist

- [x] CI hijau di GitHub: run #17 pada `1b7f262` **success** (4/4 job) — api (ruff +
      237 pytest + coverage gate 70%), admin (lint + vitest + build), mobile (lint +
      vitest + build), android-apk + artefak APK. Verifikasi lokal: 237 pytest (coverage
      76,66%), 81+25 vitest, lint bersih, build ketiga app + APK debug.
- [x] Unit/component test logika baru: API 26 test (blok, progres, CTA, penilaian kuis
      + ambang, endpoint user/admin, anti dobel poin, event/streak/notif di DB), mobile
      +15 vitest (util e-learning), admin +11 (util editor blok/soal).
- [x] UI 100% dari `tokens.css` — kelima view Elearning/ModuleDetail/Quiz/Result,
      ModulesView admin, dan polish onboarding nol hardcode warna/jarak (nilai non-token
      hanya angka desain mockup seperti cover 64px / ring 120px / titik progres 24×6px
      yang tercantum literal di mockup; angka & tanggal via Intl id-ID).
- [x] State lengkap: daftar modul (skeleton 3 kartu, empty "Belum ada modul…", error +
      Coba Lagi, offline-bar global), detail & pelajaran (skeleton/error), kuis (skeleton,
      error, guard "pilih jawaban dulu"), refleksi best-effort, admin (skeleton, error +
      Coba Lagi, empty, 409 informatif).
- [x] Aksesibilitas: tap target ≥44px (back-btn 44, tombol 48, opsi kuis ≥48, baris
      pelajaran seluruh-area), `role=progressbar` + aria-valuenow (bar modul), ring hasil
      `role=img` + aria-label skor, `aria-live=polite` perpindahan slide onboarding,
      fieldset/legend + radio berlabel untuk kunci jawaban, teks Arab `lang=ar` + `dir=rtl`,
      ikon `aria-hidden`, `prefers-reduced-motion` & `:focus-visible` global dari tokens.css.
- [x] Microcopy Bahasa Indonesia; tanpa emoji sebagai ikon (FontAwesome 6).
- [ ] Teruji di perangkat Android nyata / browser interaktif — **belum di sesi ini**
      (tool browser & perangkat tidak tersedia; item terbuka sejak Sprint 0). Pengganti
      terukur: smoke E2E 13 langkah + unit/component test + APK debug.
- [x] Terdokumentasi: `api/README.md` (endpoint + arsitektur e-learning + env + seed),
      `admin/README.md` (modul E-Learning), `mobile/README.md` (Sprint 7),
      `.env.example`, laporan ini.

---

## 7. Blokir & Keputusan yang Masih Terbuka

| # | Item | Dampak | Perlu keputusan |
|---|---|---|---|
| 1 | Kredensial FCM server (terbuka sejak Sprint 0) | Push kuis/streak/modul masih log-only | Sprint 8 (composer push) |
| 2 | Perangkat Android nyata + browser interaktif (terbuka sejak Sprint 0) | Tinjauan visual layar Belajar/Kuis & alur swipe onboarding belum di perangkat | Demo segera setelah tersedia (APK siap: `adb install`) |
| 3 | Hosting staging + `LLM_API_KEY` (terbuka sejak Sprint 0) | Tidak spesifik Sprint 7 (kuis tanpa LLM) | Sprint 8 |
| 4 | Ambang & hadiah kuis (70% / +20) + angka progres — ratifikasi PO | Nilai = angka mockup, env-driven | Review PO — bisa diubah tanpa deploy |
| 5 | Konten "Aksi hari ini" belum terhubung misi otomatis | Refleksi menampilkan teks aksi dari admin; misi terkait diklaim manual (seed sudah menyediakan misi refleksi) | Backlog Fase 2 bila diinginkan |
| 6 | Sisa wiring Google Sign-In native + OAuth Client ID (Sprint 1) | Tidak memblokir Sprint 8 | Fleksibel |

---

## 8. Yang Menyusul (Sprint 8 — Notifikasi, QA, Rilis)

Notif event (streak reminder, misi approve, misi baru — FCM + `notifications`, pengirim
`PushSender` tinggal dipasangi kredensial), composer push admin (semua/segmen — token
`fcm_tokens` + broadcast yang sengaja belum dilayani), QA cross-device Android (APK siap),
hardening (rate limit global, security header, Sentry, rekap event `analytics_events` kini
lengkap: `scan_pertama`, `misi_selesai`, `streak_hari`, `modul_selesai`), dan rilis Play
Store internal testing + release notes. Kontrak yang sudah siap: seluruh event PRD §8 sudah
tercatat, badge engine hybrid aktif untuk semua kriteria seed, dan mutasi pengguna admin
(blokir/role/reset poin) diusulkan masuk Sprint 8 menyusul catatan Sprint 4.
