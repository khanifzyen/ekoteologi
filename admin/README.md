# Admin — Ekoteologi AR

Panel admin (Vue 3 + Vite + TypeScript + Pinia + Vue Router). Acuan visual: `docs/desain/admin/`
(mockup D3 — shell sidebar + topbar, `admin.css`).

## Fitur Sprint 0

- Shell admin sesuai mockup: sidebar (brand, nav + label grup, drawer <1024px), topbar
  (hamburger, pencarian, notifikasi), profil user + keluar.
- Halaman login (email + kata sandi) terhubung `POST /v1/auth/login`.
- **Role guard**: hanya role `admin` / `verifier` / `editor` yang bisa masuk panel
  (guard router memanggil `/v1/auth/me` untuk memastikan role); role lain di-logout otomatis.
- Komponen inti: `BaseButton`, `BaseCard`, `BaseChip`, `BaseInput`, `BaseTabs`,
  `BaseSkeleton`, `ToastHost` (`src/components/ui/`) — semua memakai token.

## Dashboard KPI + Chart (Sprint 3–4)

`DashboardView` menampilkan mockup `admin/index.html` lengkap (read-only):

| Kartu / Panel | Sumber data |
|---|---|
| Pengguna Terdaftar (+baru 7 hari) | `GET /v1/admin/kpi` → `users` |
| Total Scan Hari Ini (+total) | `scans` |
| Antrian Verifikasi (bukti misi menunggu review) | `user_missions` status `pending` |
| Biaya LLM (bulan berjalan, gaya "Rp84,5rb") | `llm` — token scan non-cache × `LLM_COST_PER_1K_TOKENS`; mock mode = Rp0 |
| Chart garis: scan harian (14 hari, tick + anotasi puncak) | `GET /v1/admin/charts` → `daily` |
| Chart batang: komposisi kategori (7 hari, %) | `charts` → `categories` |

Chart adalah SVG inline gaya editorial (gridline halus, 4 tick, aksen gold,
animasi draw yang otomatis mati pada `prefers-reduced-motion` — port 1:1 dari
mockup). Matematika skala/geometry diekstrak ke `utils/chart.ts` dan diuji vitest.
Cache LLM hit rate tampil di kaki chart garis (hit/total + persen).

## Modul Pengguna & Misi (Sprint 4)

- **`UsersView` (`/pengguna`)** — tabel pengguna read-only sesuai mockup
  `pengguna.html`: filter chips (Semua/User/Verifier/Editor/Admin/Nonaktif),
  pencarian debounce (nama/email/kota), badge role & status, pagination
  ("Menampilkan 1–20 dari N"), level dihitung server. Aksi kelola (blokir,
  ubah role, reset poin) menyusul sesuai rencana sprint.
- **`MissionsView` (`/misi`)** — CRUD misi: form panel (judul, deskripsi, tipe,
  poin, mode verifikasi, target aksi, ikon, periode mulai/selesai, aktif) —
  tulis: admin+editor, hapus: admin (ditolak bila sudah ada klaim → nonaktifkan).
  Panel "Klaim Masuk" menampilkan ringkasan antrian bukti + tombol menuju
  modul Verifikasi.

## Modul Verifikasi Misi (Sprint 5)

**`VerificationView` (`/verifikasi`)** — 1:1 mockup `verifikasi.html`, aksi
`POST /v1/admin/claims/{id}/review` (role admin & verifier; editor hanya bisa
melihat):

- **Preview bukti besar** (`verif-stage`) + **strip antrian** thumbnail
  (`queue-strip`, `role=listbox`) — klik untuk pindah item.
- **Panel detail**: judul misi + sub ("Mingguan · verifikasi foto · +50 poin"),
  pengguna (+kota), waktu unggah ("Hari ini, 09.12"), catatan user, sejarah
  ("Misi ke-N pengguna ini" dari `user_claims_total`), dan badge consent foto.
- **Catatan review wajib saat menolak** (AUDIT.md A2) — ditolak tanpa catatan
  diblokir klien & server (400), fokus pindah ke textarea.
- **Keyboard shortcut**: `A` = setujui, `R` = tolak, `←`/`→` = pindah antrian
  (diabaikan saat fokus di input/textarea; didokumentasikan di `kbd-row`).
- Setuju → poin lewat ledger + notifikasi in-app + event `misi_selesai`
  (semua server-side); item keluar dari antrian, halaman berikutnya dimuat
  otomatis bila masih ada. State lengkap: skeleton, error + Coba Lagi, dan
  empty "Antrian selesai!".

## Modul Konten Harian (Sprint 6)

**`ContentsView` (`/konten`)** — CRUD `daily_contents` (PRD §5.6) sesuai story
"Konten harian: CRUD + penjadwalan (admin)":

- **Penjadwalan = `publish_date`** (tanggal tayang; UNIQUE — satu konten per
  hari, bentrok → 409 dengan pesan tanggal). Konten bertanggal hari ini
  langsung tayang di kartu "Kutipan Hari Ini" beranda aplikasi; hari tanpa
  jadwal otomatis menampilkan kutipan bank terkurasi server.
- **Form panel**: tanggal, tipe (Ayat/Hadis/Refleksi), judul, isi kutipan
  (wajib), sumber, "Aksi hari ini" (mis. "setor 1 botol ke bank sampah"),
  URL gambar opsional.
- **Tabel**: tanggal terdekat dulu, tipe, pratinjau isi + sumber, aksi hari
  ini, badge status **Tayang/Terjadwal**, ubah (admin·editor) & hapus (admin,
  confirm + audit log). State lengkap: skeleton, error + Coba Lagi, empty
  ("Belum ada konten terjadwal…").

## Modul E-Learning (Sprint 7)

**`ModulesView` (`/e-learning`)** — CRUD modul + editor blok pelajaran (JSONB)
+ bank soal kuis sesuai story "Admin: CRUD modul + editor blok lesson (JSONB)
+ bank soal" (`mobile/elearning.html` sebagai acuan bentuk blok):

- **Tabel modul**: judul + slug + ikon (FontAwesome/URL), rekap pelajaran &
  soal, urutan, badge **Tayang/Draft**; aksi Kelola / Ubah / Hapus (admin,
  confirm + audit log; server menolak 409 bila modul sudah dikerjakan
  pengguna — jaga riwayat).
- **Form modul**: judul (slug otomatis dipratinjau), deskripsi, ikon
  (`fa-leaf` dsb. atau URL gambar), urutan, centang tayang.
- **Panel Kelola** per modul, dua kolom:
  - *Pelajaran* — daftar urut dgn ringkasan blok ("2 paragraf · 1 kutipan"),
    tambah/ubah/hapus. Editor blok: tambah blok **Paragraf/Kutipan/Tip**,
    tiap blok bisa naik/turun/hapus; kutipan punya field teks Arab (RTL),
    terjemahan, dan sumber. Validasi klien + server (blok invalid → 400
    pesan blok ke-N).
  - *Bank Soal* — daftar soal dgn kunci jawaban; form soal: pertanyaan,
    4 pilihan (minimal 2 terisi) + radio kunci jawaban, penjelasan yang
    tampil di bedah jawaban setelah kuis. Kuis per modul dibuat otomatis
    saat soal pertama ditambahkan.
- Role: tulis admin·editor; hapus admin. Logika editor diekstrak ke
  `utils/elearning.ts` (murni, 11 test vitest).

## Composer Push (Sprint 8)

**`PushView` (`/push`, menu "Push Notifikasi" grup Sistem)** — story
"Admin: composer push (semua/segmen) — role admin saja; audit log":

- **Kartu segmen** (dari `GET /v1/admin/push/segments`): Semua pengguna
  aktif · Aktif 7 hari terakhir · Pasif >7 hari · Punya token push — tiap
  kartu menampilkan jumlah penerima + perangkat; kartu segmen terpilih
  di-highlight.
- **Composer**: judul (4–64), isi (8–300), pilih segmen lewat chip
  (`aria-pressed`); konfirmasi menampilkan estimasi penerima/perangkat.
  Kirim → `POST /v1/admin/push/broadcast` (**server menolak role non-admin**,
  mencatat audit `push.broadcast` dgn rekap penerima). Panel hasil +
  toast menampilkan "Terkirim ke N dari M perangkat (K penerima)".
- **Riwayat Broadcast**: 20 pengiriman terakhir (waktu, pesan, segmen,
  penerima/perangkat/terkirim dari payload).
- Role panel lain (verifier/editor) melihat data read-only dgn keterangan
  "Hanya role Admin yang dapat mengirim push".
- Logika komposer murni ada di `utils/push.ts` (validasi, ringkasan,
  label riwayat — teruji vitest).

## Perintah

```bash
npm ci
npm run dev        # http://localhost:5174
npm run lint       # eslint (flat config)
npm run test       # vitest (util chart + verifikasi + e-learning + push)
npm run build      # vue-tsc (typecheck) + vite build
```

## Konfigurasi

Salin `.env.example` → `.env`:

| Var | Default | Keterangan |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8100` | Base URL API FastAPI |

## Struktur

```
src/
├── api/client.ts       # fetch wrapper + ApiError (pesan dari detail backend)
├── components/         # KpiCard, ChartLine, ChartBar (Sprint 3–4) + komponen inti ui/ (Sprint 0)
├── layouts/AdminShell  # sidebar + topbar + drawer (mockup index.html)
├── router/index.ts     # rute + role guard
├── stores/             # auth (sesi+role), toast
├── styles/             # tokens.css (salinan docs/desain), admin.css (mockup), app.css (tambahan)
├── utils/chart.ts      # matematika chart (murni, teruji vitest)
├── utils/verification.ts # helper layar verifikasi (murni, teruji vitest)
├── utils/push.ts       # validasi & label composer push (murni, teruji vitest — Sprint 8)
└── views/              # LoginView, DashboardView (KPI+chart), UsersView, VerificationView, MissionsView, ContentsView, PushView (Sprint 8)
```

Catatan: item menu "Audit Log" dan "Laporan" sengaja masih nonaktif dgn toast
"menyusul" (endpoint audit ada sejak Sprint 0 — viewer belum jadi story);
item Fase 2 diberi tanda *Segera* seperti mockup.
