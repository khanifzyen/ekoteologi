# DESIGN.md — Ekoteologi AR Design System

> Single source of truth untuk desain Ekoteologi AR. Dibuat di Fase D0 (lihat `docs/desain.md`).
> Semua frontend (mobile mockup, admin mockup, dan nanti aplikasi Vue) **wajib** memakai token
> dari `docs/desain/tokens.css` — nol hardcode warna/spacing/typografi.

- Status: v1.0 (Fase D0 selesai)
- Scope: light mode only (MVP). Struktur token disusun agar dark mode mudah ditambah.
- Aksesibilitas: WCAG 2.1 AA — semua pasangan teks ≥4.5:1, UI besar/ikomponen non-teks ≥3:1 (angka tercantum per token).

---

## 1. Prinsip Desain

1. **Ekologis-spiritual, bukan eco-kitsch** — hijau tenang + aksen gold bermakna (poin/reward), bukan dekorasi.
2. **Bersih & terpercaya** — surface putih, hierarki jelas, radius besar (karakter organik), shadow lembut hijau.
3. **Mobile-first** — basis 390px, nyaman di 360px; di desktop browser dibatasi `max-width: 480px` terpusat.
4. **Motion halus & bermakna** — 150–400ms, ease-out; animasi khas hanya di layar scan (signature).
5. **Bahasa Indonesia** untuk semua microcopy, hangat tapi ringkas ("Assalamu'alaikum", "Alhamdulillah", "Yuk").

---

## 2. Brand

**Nama:** Ekoteologi AR
**Tagline:** *Jaga bumi, jaga iman.*
**Karakter:** tenang, bersih, terpercaya, hangat, memotivasi (bukan menghakimi).
**Ikonografi:** FontAwesome 6 (solid). Ikon khas: seedling, tree, recycle, bullseye, book-quran, camera, leaf, coins.
**Ilustrasi:** bentuk ikon bertumpuk + lingkaran lembut, hindari foto stock sebagai elemen identitas.

---

## 3. Tipografi

| Token | Nilai |
|---|---|
| `--font-heading` | `'Montserrat', system-ui, sans-serif` — bobot 600/700/800 |
| `--font-body` | `'Open Sans', system-ui, sans-serif` — bobot 400/600/700 |
| `--font-arabic` | `'Amiri', serif` — untuk teks Arab kutipan (opsional) |

Skala (mobile-first, `px`; gunakan `rem` di implementasi Vue dengan root 16px):

| Token | Ukuran | Line-height | Penggunaan |
|---|---|---|---|
| `--text-xs` | 12px | 1.45 | label kecil, caption nav |
| `--text-sm` | 14px | 1.5 | teks sekunder, form helper |
| `--text-md` | 16px | 1.6 | body default, input |
| `--text-lg` | 20px | 1.35 | subjudul kartu, judul section |
| `--text-xl` | 24px | 1.25 | judul halaman |
| `--text-2xl` | 28px | 1.2 | angka poin, hero |

Aturan:
- Heading selalu `--font-heading` + warna `--color-heading`.
- Body `--font-body`, warna `--color-text`.
- Angka poin/statistik: Montserrat 800, bisa `font-variant-numeric: tabular-nums` di admin.
- Jangan bobot <400; jangan teks <12px.

---

## 4. Warna

### 4.1 Palet Inti (primitive)

| Token | Nilai | Kontras utama (diukur) |
|---|---|---|
| `--primary-green` | `#2E7D32` | di atas putih 5.13:1 ✅ teks |
| `--primary-green-strong` | `#1B5E20` | di atas putih 7.87:1 ✅ teks |
| `--primary-green-deep` | `#0F4D14` | di atas putih 10.04:1 ✅ (fokus/heading kuat) |
| `--primary-green-soft` | `#E8F5E9` | surface hijau lembut |
| `--light-green` | `#81C784` | dekoratif/ilustrasi saja (kontras rendah — bukan teks) |
| `--bg-green` | `#F1F8E9` | background layar mobile |
| `--gold` | `#FFC107` | hanya di atas hijau gelap (4.83:1 ✅) atau sebagai fill FAB |
| `--gold-light` | `#FFD54F` | teks/ikon di atas `--primary-green-strong` (5.58:1 ✅) |
| `--gold-dark` | `#FBC02D` | variasi gradient FAB/progress |
| `--gold-text` | `#8A5A00` | teks bernuansa gold di atas putih (5.93:1 ✅) |
| `--danger` | `#D32F2F` | di atas putih 4.98:1 ✅ teks (menggantikan #E53935 yang gagal AA) |
| `--danger-dark` | `#B71C1C` | di atas `#FDECEA` 5.74:1 ✅; di atas putih 6.57:1 ✅ |
| `--danger-soft` | `#FDECEA` | surface error |

**Aturan gold:** `--gold` DILARANG untuk teks di atas putih (1.63:1 — gagal total). Pemakaian sah:
1. Fill FAB scan / ikon besar di atas hijau gelap.
2. Teks/ikon gold di atas hijau gelap (header, kartu gradient).
3. Teks bernuansa gold di latar terang → WAJIB `--gold-text` (#8A5A00).

### 4.2 Neutral (ink + line)

| Token | Nilai | Kontras | Peran |
|---|---|---|---|
| `--ink-900` | `#212121` | 16.10:1 di putih ✅ | heading, teks utama |
| `--ink-600` | `#666666` | 5.74:1 di putih; 5.29:1 di bg-green ✅ | teks sekunder (menggantikan #757575 yang gagal di bg-green) |
| `--ink-400` | `#9E9E9E` | 2.68:1 ❌ teks | HANYA placeholder/disabled — bukan teks konten |
| `--ink-300` | `#BDBDBD` | — | ikon dekoratif |
| `--line` | `#E0E0E0` | 1.32:1 | border halus (dekoratif, non-teks) |
| `--line-strong` | `#C8C8C8` | — | border input aktif berpasangan dgn focus ring |
| `--surface` | `#FFFFFF` | — | kartu, nav, sheet |
| `--surface-alt` | `#FAFAFA` | — | section di dalam kartu |
| `--surface-muted` | `#F1F8E9` | — | area tenang di dalam kartu (sama dengan bg-green) |

### 4.3 Semantic

| Token | Nilai (light) | Catatan kontras |
|---|---|---|
| `--color-bg` | `var(--bg-green)` | bg layar mobile |
| `--color-bg-admin` | `#F6F8F5` | bg admin (netral-hijau sangat lembut) |
| `--color-surface` | `#FFFFFF` | |
| `--color-surface-raised` | `#FFFFFF` + `--shadow-1` | |
| `--color-border` | `var(--line)` | |
| `--color-border-strong` | `var(--line-strong)` | |
| `--color-text` | `var(--ink-900)` | body |
| `--color-heading` | `var(--primary-green-strong)` | heading di latar terang |
| `--color-text-muted` | `var(--ink-600)` | ✅ AA di putih & bg-green |
| `--color-primary` | `var(--primary-green)` | 5.13:1 di putih ✅ |
| `--color-primary-strong` | `var(--primary-green-strong)` | |
| `--color-primary-fg` | `#FFFFFF` | teks di atas primary |
| `--color-on-dark` | `#FFFFFF` | teks di atas hijau gelap |
| `--color-accent` | `var(--gold)` | fill dekoratif / FAB saja |
| `--color-accent-fg` | `var(--primary-green-strong)` | ikon/teks di atas gold (4.83:1 ✅) |
| `--color-accent-text` | `var(--gold-text)` | teks "gold" di latar terang |
| `--color-success` | `var(--primary-green-strong)` | |
| `--color-success-fg` | `#FFFFFF` | |
| `--color-success-soft` | `var(--primary-green-soft)` | |
| `--color-danger` | `var(--danger)` | 4.98:1 di putih ✅ |
| `--color-danger-strong` | `var(--danger-dark)` | |
| `--color-danger-fg` | `#FFFFFF` | |
| `--color-danger-soft` | `#FDECEA` | |
| `--color-info` | `#0277BD` | 4.80:1 di putih ✅ |
| `--color-info-soft` | `#E3F2FD` | |
| `--color-focus` | `var(--primary-green-strong)` | focus ring 2px + offset |
| `--color-scrim` | `rgba(15,25,15,0.55)` | overlay modal/sheet |
| `--color-header-grad` | `linear-gradient(180deg, var(--primary-green) 0%, var(--primary-green-strong) 100%)` | header melengkung |

### 4.4 Kategori Sampah (khusus scan & misi)

| Token | Fill (soft) | Teks/ikon | Kontras pasangan |
|---|---|---|---|
| `--cat-organik` / `-soft` | `#E8F5E9` | `#1B5E20` | 7.00:1 ✅ |
| `--cat-plastik` / `-soft` | `#E3F2FD` | `#0277BD` | 4.80:1 ✅ (di putih) |
| `--cat-b3` / `-soft` | `#FDECEA` | `#B71C1C` | 5.74:1 ✅ |
| `--cat-residu` / `-soft` | `#EFEBE9` | `#5D4037` | 7.87:1 ✅ |

> Catatan: teks di atas `--cat-plastik-soft` memakai `#0277BD` di atas `#E1F0FA` hanya 4.12:1 → untuk chip kategori, gunakan bobot 600+ dan ukuran ≥14px (large text AA 3:1 terpenuhi), atau beri background putih di dalam chip. Standar aman: ikon + teks ≥14px semibold.

### 4.5 Status UI

| Status | Tampilan |
|---|---|
| Disabled | background `--line`, teks `--ink-400`, `cursor: not-allowed` |
| Focus-visible | outline 2px `--color-focus`, offset 2px |
| Loading | skeleton `--line` → shimmer ke `#E8E8E8` |
| Skeleton | `var(--line)` base |
| Scrim (modal) | `--color-scrim` |

---

## 5. Spacing, Radius, Elevation

### Spacing (skala 4px)
`--space-1`: 4px · `--space-2`: 8px · `--space-3`: 12px · `--space-4`: 16px · `--space-5`: 24px · `--space-6`: 32px · `--space-7`: 48px · `--space-8`: 64px

Aturan: padding kartu `--space-4/5`; gap grid `--space-3/4`; layar `--space-4` sisi; bottom nav clearance `--space-7` (FAB overlap).

### Radius
`--radius-sm`: 8px (input, chip kecil) · `--radius-md`: 16px (input besar, kartu kecil) · `--radius-lg`: 24px (kartu, sheet) · `--radius-pill`: 999px (tombol pill, badge) · `--radius-header`: 32px (header melengkung — signature; prototipe memakai 30–40px, distandarkan 32px)

### Elevation (shadow bernuansa hijau)
| Token | Nilai | Peruntukan |
|---|---|---|
| `--shadow-1` | `0 2px 8px rgba(27,94,32,.08)` | kartu biasa |
| `--shadow-2` | `0 10px 20px rgba(46,125,50,.20)` | header, kartu hero |
| `--shadow-fab` | `0 -4px 15px rgba(0,0,0,.15)` | FAB scan |
| `--shadow-sheet` | `0 -5px 25px rgba(0,0,0,.20)` | bottom sheet / panel AR |

---

## 6. Motion

| Token | Nilai |
|---|---|
| `--dur-fast` | 150ms — hover, press, toggle |
| `--dur-base` | 250ms — sheet, panel masuk, tab |
| `--dur-slow` | 400ms — transisi layar |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-spring` | `cubic-bezier(0.175, 0.885, 0.32, 1.275)` — khusus bottom sheet AR |

Aturan:
- Durasi maksimum animasi UI **350ms** (kecuali `--dur-slow` untuk transisi layar penuh).
- **Wajib** hormati `prefers-reduced-motion: reduce` → semua animasi non-esensial dimatikan/dipertidak jelas; animasi scan diganti fade sederhana.
- Animasi khas (sweep scan, stagger panel AR) hanya di layar scan.
- Press feedback: `scale(0.96–0.97)` + `--dur-fast`.

---

## 7. Layout & Grid

| Aturan | Nilai |
|---|---|
| Basis desain mobile | 390px; aman di 360px |
| Mobile di desktop | `max-width: 480px`, `margin-inline: auto`, bg di luar frame = `--color-bg` |
| Konten layar mobile | padding-inline `--space-4` (16px); maks kolom teks `62ch` |
| Bottom nav | tinggi 60px + safe-area; FAB scan 65px, 20px dari bawah nav, z-index 10 |
| Tap target | **≥44×44px** semua elemen interaktif |
| Admin | container 1280px; sidebar 260px tetap di ≥1024px, drawer <1024px; tabel → kartu <768px |
| Breakpoint | 360 / 480 / 768 / 1024 / 1280 |

---

## 8. Ikon

- FontAwesome 6 (CDN: cdnjs 6.4.x) — solid style.
- Ukuran: nav 20px, menu 28px, ikon kartu 18–24px, FAB 26px.
- Warna ikon mengikuti warna teks komponen; ikon dekoratif boleh `--light-green`/`--ink-300`.
- Ikon kategorikal: organik `fa-seedling`, plastik `fa-recycle`, B3 `fa-triangle-exclamation`, residu `fa-trash-can`, poin `fa-coins`, streak `fa-fire`, scan `fa-camera`, misi `fa-bullseye`, e-learning `fa-book-open`/`fa-graduation-cap`.
- **Tidak boleh** emoji sebagai ikon.

---

## 9. Komponen Inti (spesifikasi ringkas)

| Komponen | Spec |
|---|---|
| **Button** | Tinggi 48px (mobile) / 40px (admin); radius `--radius-md`; primary: bg `--color-primary`, teks putih; secondary: bg putih, border 1.5px `--primary-green`, teks `--primary-green`; ghost: teks `--primary-green`, transparan; destructive: bg `--color-danger`, teks putih; gold CTA: bg `--gold`, teks `--color-accent-fg`, bobot 700. Press: scale(0.97). Tap ≥44px. |
| **Card** | bg `--surface`, radius `--radius-lg`, shadow `--shadow-1`, padding `--space-4/5`. |
| **Input** | Tinggi 48px, radius `--radius-sm`, border 1.5px `--line-strong`; focus: border `--primary-green` + ring 2px; label `--text-sm` semibold di atas; error: border `--color-danger` + pesan `--text-xs` warna `--color-danger`. |
| **Chip / Badge** | Pill, `--text-xs` semibold; kategori sampah pakai pasangan token §4.4. |
| **Bottom nav (mobile)** | Tinggi 60px, bg putih, shadow atas; item aktif `--primary-green` + semibold; FAB scan gold di tengah (65px, border 4px putih). |
| **Header melengkung** | Gradient §4.3, radius bawah `--radius-header`, padding bawah besar (±70px) agar konten menumpuk dengan margin negatif -50px. Signature layar utama. |
| **Modal / Bottom sheet** | Sheet: radius atas `--radius-lg`, drag-handle 40×5 `--line`, `--shadow-sheet`, scrim `--color-scrim`; masuk `--ease-spring` 250–350ms. |
| **Toast** | Pill, bg `--ink-900` 90%, teks putih, bawah-tengah, auto-hide 3s. |
| **Skeleton** | Block radius `--radius-sm` bg `--line`, shimmer 1.2s. |
| **Empty state** | Ikon lingkaran besar di `--primary-green-soft`, judul `--text-lg` heading, deskripsi `--color-text-muted`, CTA sekunder. |
| **Ring progress** | SVG stroke `--primary-green`, track `--line`, label tengah Montserrat 700. |
| **Level badge** | Pill putih-transparan di header (border putih 30%), ikon seedling gold-light. |
| **Streak** | Ikon fire `--gold` (di atas surface putih gunakan fill gold + teks `--gold-text`). |
| **Panel AR hasil scan** | Bottom sheet + stagger anak 40–60ms, `--ease-spring`; konten: nama item, chip kategori, poin (+N), saran buang, quote (blok hijau lembut border-kiri 4px `--primary-green`). |

---

## 10. Do & Don't

**Do**
- Semua warna/jarak/ukuran dari token; angka di file CSS hanya 0, token var(), dan nilai turunan (%, dsb).
- Teks muted = `--ink-600`; heading di latar terang = `--primary-green-strong` atau `--ink-900`.
- Kontras dicek dengan formula WCAG; jika ragu, teks di atas soft fill harus ≥4.5:1.
- `lang="id"` + microcopy Indonesia.
- Ikon selalu punya `aria-hidden="true"` kecuali bermakna sendiri (kasih `aria-label`).

**Don't**
- ❌ Teks `--gold` di atas putih/terang (gagal kontras parah).
- ❌ Teks `--ink-400` untuk konten sebenarnya (hanya placeholder).
- ❌ `#757575` untuk teks di atas `--bg-green` (4.24:1, gagal) → pakai `--ink-600` #666666.
- ❌ Emoji sebagai ikon.
- ❌ Radius campur aduk; kartu selalu `--radius-lg` kecuali chip/input.
- ❌ Animasi >400ms atau bounce di luar sheet AR.
- � Green neon (`#00E676` dsb.) — bukan karakter brand; kecuali indikator "objek terdeteksi" di scan (di atas foto gelap, konteks kamera, kontras tinggi vs frame putih — bukan warna teks brand).

---

## 11. Riwayat Audit Kontras (D0)

Pasangan yang gagal di prototipe dan perbaikannya:

| Masalah | Nilai | Perbaikan |
|---|---|---|
| Teks gold #FFC107 di putih | 1.63:1 ❌ | Gold hanya di atas hijau gelap; teks gold-ish di terang = `--gold-text` #8A5A00 (5.93:1) |
| #757575 di bg-green | 4.24:1 ❌ | `--ink-600` → #666666 (5.29:1) |
| #9E9E9E teks di putih | 2.68:1 ❌ | hanya placeholder/disabled |
| #E53935 teks di putih | 4.23:1 ❌ | `--danger` → #D32F2F (4.98:1) |
| Tag oranye #E65100 di #FFF3E0 | 3.46:1 ❌ | teks B3 = `#B71C1C` di `#FDECEA` (5.74:1) |

Semua pasangan semantic lolos AA — rincian di §4.
