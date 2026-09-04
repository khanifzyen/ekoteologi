# AUDIT.md — Review & Polish Desain Ekoteologi AR (Fase D4)

> Hasil audit menyeluruh atas mockup D0–D3 menggunakan skill `web-design-guidelines`,
> `impeccable-design-polish`, dan `design-review`.
> Tanggal: 4 September 2026 · Auditor: sesi desain otomatis (D4)

---

## 1. Ruang Lingkup Audit

| Area | File |
|---|---|
| Token & style guide | `docs/DESIGN.md`, `docs/desain/tokens.css` |
| Mobile | `docs/desain/mobile/` — onboarding, auth, beranda, misi, elearning, scan, index + base.css |
| Admin | `docs/desain/admin/` — index (dashboard), pengguna, verifikasi + admin.css |

Metode: pemeriksaan terhadap Web Interface Guidelines (Vercel) + checklist DoD `docs/desain.md` §8 + verifikasi kontras WCAG (formula relatif luminans, hasil di `DESIGN.md` §11) + parser HTML untuk struktur tag.

---

## 2. Temuan & Perbaikan

### 2.1 Global (semua mockup)

| # | Temuan | Severity | Perbaikan | Sebelum → Sesudah |
|---|---|---|---|---|
| G1 | `transition: all` (anti-pattern; animasi properti tak terkelola) | Sedang | Diganti properti eksplisit | `auth.html` (.seg button), `onboarding.html` (dot), `scan.html` (toast inline) → `transition: background …, color …, box-shadow …` |
| G2 | Tanpa `<meta name="theme-color">` | Rendah | Ditambahkan ke 10 file HTML | — → `#2E7D32` (mobile/admin), `#1B5E20` (scan, latar gelap kamera) |
| G3 | Tanpa `touch-action: manipulation` & `-webkit-tap-highlight-color` (delay double-tap di Android) | Sedang | Ditambahkan di `base.css`, `admin.css`, `scan.html` | — → `touch-action: manipulation` pada body + elemen interaktif |
| G4 | Modal/sheet/drawer tanpa `overscroll-behavior: contain` (scroll-through ke halaman) | Sedang | `.sheet`, `.permission` (scan), `.sidebar` drawer (admin) | — → `overscroll-behavior: contain` |
| G5 | Heading tanpa `text-wrap: balance` (widows di judul) | Rendah | Ditambahkan ke h1–h4 (base.css, admin.css, scan.html) | |
| G6 | Gambar tanpa dimensi eksplisit (risiko CLS) & tanpa lazy-load | Sedang | Avatar tabel admin `width/height="34"` + `loading="lazy"`; avatar topbar/side 36×36; avatar beranda 46×46; proof image 900×640; thumbnail antrian lazy | |

### 2.2 Mobile

| # | File | Temuan | Perbaikan |
|---|---|---|---|
| M1 | `auth.html` | Error inline muncul tapi fokus tidak dipindah ke field pertama yang salah | Submit handler kini mem-`focus()` field invalid pertama |
| M2 | `auth.html` | Password toggle ada ✓, label di atas input ✓, SSO pakai SVG resmi ✓ (bukan emoji) | Lolos checklist login-flow P0 |
| M3 | `scan.html` | Toast memakai inline style + `transition: all` | Dipindah ke class `.toast` di `<style>` dengan transisi properti eksplisit |
| M4 | `scan.html` | Sheet hasil 62dvh + frame di 17dvh → **objek hasil scan tidak tertutup panel** ✓; nama item terbaca seketika saat sheet terbuka ✓ (kriteria D2) | Lolos |
| M5 | `scan.html` | Animasi: transisi UI 180–320ms (≤350ms) ✓; sweep loop ambient 2.2s adalah *continuous feedback*, bukan transisi — didokumentasikan; `prefers-reduced-motion` dinonaktifkan global oleh `tokens.css` (sweep jadi garis statis, sheet muncul instan) | Lolos dengan catatan |
| M6 | `misi.html` | Logika tab: `classList.toggle(\|\|)` buggy (aria-selected tak selalu ter-set) | Ditulis ulang `forEach` eksplisit |
| M7 | `beranda.html` | Label "Contoh Kebaikan Hari Ini" salah makna (bukan contoh) | → "Kutipan Hari Ini" |
| M8 | `elearning.html` | Inline style mati pada kartu konten harian | Dihapus, styling via class |
| M9 | Semua mockup mobile | Framing 390px; desktop dibatasi `max-width: 480px` terpusat ✓; tap target ≥44px (nav item 48px, tombol 48px, icon-btn 44px) ✓ | Lolos |

### 2.3 Admin

| # | File | Temuan | Perbaikan |
|---|---|---|---|
| A1 | `pengguna.html` | Aksi **Blokir** bersifat destruktif tapi langsung eksekusi tanpa konfirmasi | `blockUser(name)` dengan `confirm()` + pesan dampak + keterangan audit log |
| A2 | `verifikasi.html` | Tolak tanpa catatan kini diblokir (catatan wajib) + fokus ke textarea ✓; keyboard A/R/←/→ ✓ (dengan guard saat fokus di input) | Lolos |
| A3 | `index.html` | Chart hand-written SVG: axis hairline, 4 tick, 1 warna ink + 1 accent gold, anotasi titik kunci, reveal `stroke-dashoffset` yang otomatis mati pada reduced-motion ✓ (gaya editorial NYT per skill `frame-data-chart-nyt`) | Lolos |
| A4 | Semua | Sidebar ≥1024px tetap, <1024px drawer + overlay, <768px tabel → kartu bertumpuk via `data-label` ✓ | Lolos |

---

## 3. Pengecualian yang Disengaja (didokumentasikan)

1. **Warna logo Google** di `auth.html` — SVG resmi Google Sign-In memakai warna brand Google (#4285F4 dst.); bukan warna produk, pengecualian wajar.
2. **`<meta name="theme-color">`** — nilai hex statis (atribut meta tidak bisa memakai CSS var): `#2E7D32` / `#1B5E20`, konsisten dengan token.
3. **Sweep scan loop 2.2s** — animasi ambient khas layar scan (signature), bukan transisi UI; tetap dihormati reduced-motion.
4. **Foto placeholder** (pravatar/picsum/unsplash) — hanya dummy mockup; diganti aset riil saat dev.
5. **Lokasi `scan.html`** di `docs/desain/mobile/` (rencana awal `docs/desain/scan.html`) — mengikuti reorganisasi; semua tautan lintas-mockup sudah disesuaikan (`scan.html`, bukan `../scan.html`).
6. **Commits atomic belum dibuat** — menunggu konfirmasi user (aturan: jangan commit tanpa diminta). Perbaikan di atas siap dipecah jadi commit atomic per file.

---

## 4. Checklist Definition of Done (docs/desain.md §8)

- [x] Warna/font/spasi/radius/shadow 100% dari token — nol hardcode (pengecualian §3.1–3.2)
- [x] Kontras teks ≥4.5:1, UI besar ≥3:1 — terukur, rincian `DESIGN.md` §4 & §11
- [x] Tap target ≥44px (mobile) + focus-visible jelas (tokens.css `:where(a,button,…)`)
- [x] Loading/empty/error/offline state ada di layar data (beranda, misi, elearning, scan, verifikasi)
- [x] `prefers-reduced-motion` dihormati (global via tokens.css)
- [x] Mobile rapi di 360/390px; desktop ter-batasi 480px
- [x] Admin rapi di 1280/1024/768px (tabel → kartu <768px)
- [x] Bahasa Indonesia semua microcopy
- [x] Tanpa emoji sebagai ikon; FontAwesome 6 konsisten

**Status: lolos audit.** Tahapan desain D0–D4 selesai; siap masuk tahap development (PRD §7 Epic 1) dengan token dari `docs/desain/tokens.css` sebagai sumber kebenaran.
