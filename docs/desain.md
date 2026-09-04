# Implementation Plan — Tahapan Desain/Visual UI (Ekoteologi AR)

> Dokumen ini adalah **rencana eksekusi tahap desain** (bukan PRD fitur — lihat `docs/PRD.md`).
> Berfungsi juga sebagai **prompt kontekstual**: saat memulai sesi baru, tempel bagian [Prompt Sesi Baru](#7-prompt-sesi-baru-siap-pakai) agar sesi langsung paham konteks, skill yang diaktifkan, dan deliverable yang dituju.
>
> Status: siap dieksekusi | Sumber visual: `wireframe/` (prototipe HTML lama — referensi, bukan acuan final)

---

## 1. Ruang Lingkup

**Termasuk:** design tokens, arah visual, spesifikasi halaman mobile (user app) & admin, alur AR-scan (overlay), states (loading/empty/error), review & polish.

**Tidak termasuk:** backend, logika bisnis, integrasi API, build APK (tahap dev — lihat PRD §7 epics).

**Konteks produk:**
- User app: Vue 3 + Capacitor, **mobile-first** (Android), tetap nyaman dibuka via browser desktop.
- Admin: Vue 3, **browser-first** (desktop utama), tetap mobile friendly.
- Karakter brand: hijau-ekologis + sentuhan spiritual (ekoteologi). Tenang, bersih, terpercaya — hindari kesan template generik dan jangan "eco-kitsch".

---

## 2. Arah Desain (Design Direction)

| Aspek | Keputusan | Alasan |
|---|---|---|
| Gaya | Clean-modern dengan aksen organik (radius besar, gradasi hijau halus, ilustrasi ikon) | Dipertahankan dari prototipe, ditingkatkan konsistensinya |
| Tipografi | **Montserrat** (heading, 600–800) + **Open Sans** (body, 400–600) | Sudah dipakai prototipe; fallback: system sans |
| Warna | Hijau primary + gold sebagai aksen reward; netral hangat untuk surface | Identitas sudah terbentuk di prototipe |
| Density | Mobile: lega (tap target ≥44px). Admin: sedang (data-dense tapi breathable) | Kontras kebutuhan dua platform |
| Ikon | FontAwesome 6 (migrasi nanti ke `lucide`/`iconify` opsional) | Konsisten dengan prototipe |
| Motion | Halus & bermakna (200–350ms, ease-out). Animasi khas HANYA di scan overlay | Jangan animasi berlebihan |
| Mode gelap | **Tidak di MVP** — token disusun agar mudah ditambah kemudian | Scope control |
| Aksesibilitas | WCAG 2.1 AA (kontras teks, focus visible, area sentuh) | Wajib; gold di atas putih **gagal kontras** → perbaiki di Fase D0 |

**Breakpoints (kedua frontend):**
- Mobile: 360–480px (basis desain 390px)
- Tablet: 768px
- Desktop: 1024px / 1280px
- Aturan mobile app di desktop browser: konten dibatasi `max-width: 480px` terpusat (seperti frame prototipe) — bukan layout melebar.

---

## 3. Design Tokens (basis dari `wireframe/style.css`)

> Sumber awal; **divalidasi & dilengkapi di Fase D0** dengan `design-md` + `color-expert` (cek kontras AA, skala spasi/typo).

```css
/* ── Warna (mentah dari prototipe — WAJIB diaudit di D0) ── */
--primary-green: #2E7D32;   /* brand, header, CTA */
--dark-green:    #1B5E20;   /* gradasi header, heading */
--light-green:   #81C784;   /* aksen sekunder, ilustrasi */
--bg-green:      #F1F8E9;   /* background layar */
--surface:       #FFFFFF;   /* kartu, nav */
--gold:          #FFC107;   /* poin, reward, FAB scan — HANYA di atas hijau gelap/teks gelap */
--gold-dark:     #FBC02D;
--danger:        #E53935;   --danger-dark: #D32F2F;
--ink-900: #212121; --ink-600: #757575; --ink-400: #9E9E9E;
--line: #E0E0E0;

/* Semantic (susunan baru, wajib di D0) */
--color-bg, --color-surface, --color-border, --color-text,
--color-text-muted, --color-primary, --color-primary-fg,
--color-accent, --color-success, --color-danger

/* ── Spasi (skala 4px) ── */
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-7: 48px;

/* ── Radius ── */
--radius-sm: 8px; --radius-md: 16px; --radius-lg: 24px;
--radius-pill: 999px;  /* header melengkung: radius bawah 30–40px (signature prototipe) */

/* ── Elevation ── */
--shadow-1: 0 2px 8px rgba(27,94,32,.08);
--shadow-2: 0 10px 20px rgba(46,125,50,.20);
--shadow-fab: 0 -4px 15px rgba(0,0,0,.15);

/* ── Motion ── */
--dur-fast: 150ms; --dur-base: 250ms; --dur-slow: 400ms;
--ease-out: cubic-bezier(0.2, 0, 0, 1);

/* ── Tipografi (skala) ── */
--font-heading: 'Montserrat', system-ui, sans-serif;
--font-body:    'Open Sans', system-ui, sans-serif;
--text-xs: 12px; --text-sm: 14px; --text-md: 16px;
--text-lg: 20px; --text-xl: 24px; --text-2xl: 28px;
```

**Komponen inti (kedua frontend):** Button (primary/secondary/ghost/destructive), Card, Input + label + error, Badge/Chip, Bottom Navigation (mobile) / Sidebar (admin), Header melengkung (signature), FAB scan (gold, tengah nav), Modal/Sheet, Toast, Skeleton loading, Empty state, Tab bar.

**Komponen khas:** Panel hasil "AR" scan (kartu mengambang + animasi masuk), Ring progress misi, Level badge, Streak flame, Tree/impact visual.

---

## 4. Inventaris Layar

### 4.1 Mobile User App (7 layar + alur scan)

| # | Layar | Konten & komponen | Prioritas |
|---|---|---|---|
| 1 | Splash + Onboarding (3 slide) | Ilustrasi ikon bertumpuk, dots, CTA mulai | Tinggi |
| 2 | Auth | Login, daftar, Google, lupa password | Tinggi |
| 3 | Home/Dashboard | Header melengkung (salam, level badge, poin), kartu dampak/pohon, misi hari ini, konten harian, menu utama, bottom nav + FAB | Tinggi |
| 4 | **Scan "AR"** | Kamera live fullscreen, overlay frame scan beranimasi, shutter; hasil = panel "AR" (jenis sampah, kategori+ikon, poin, saran buang, quote) | **Tertinggi — signature** |
| 5 | Riwayat scan | List + filter kategori | Sedang |
| 6 | Misi | Tab Harian/Pencapaian, kartu misi (progres, klaim, upload bukti), lencana | Tinggi |
| 7 | E-Learning | List modul, detail lesson (blok konten), kuis, hasil kuis, konten harian | Tinggi |
| 8 | Profil & Komunitas (F2) | Statistik dampak, lencana, peta, feed | Sedang (F2: komunitas) |

**States wajib per layar:** loading (skeleton), empty (ilustrasi + CTA), error (retry), offline.

### 4.2 Admin (12 modul)

| # | Modul | Catatan desain |
|---|---|---|
| 1 | Dashboard | KPI cards + chart tren (scan/user/misi/biaya LLM) |
| 2 | User | Tabel, filter, drawer detail, aksi blokir/role |
| 3 | Verifikasi Misi | **Antrian gambar** (bukan tabel biasa): preview bukti besar + approve/reject cepat keyboard-friendly |
| 4 | Misi | CRUD + form verifikasi (photo/auto_scan/manual) |
| 5 | E-Learning | CRUD modul, editor blok lesson, bank soal kuis |
| 6 | Konten Harian | Kalender/jadwal publish |
| 7–12 | Reward, Moderasi, Peta, Push composer, Role & Audit, Laporan | F2 kecuali Push & Audit |

Admin responsive: `≥1024px` sidebar tetap; `<1024px` sidebar jadi drawer; `<768px` tabel → kartu bertumpuk.

---

## 5. Fase Eksekusi & Skill

> Aturan: **maksimal 2–3 skill per fase**, dimuat di awal sesi. Deliverable tiap fase harus selesai sebelum lanjut.

### D0 — Fondasi Token & Style Guide
| | |
|---|---|
| Skills | `design-md`, `color-expert` |
| Kerja | Audit & finalisasi token (kontras AA gold/gray, skala spasi-typo), susun `docs/DESIGN.md` + `tokens.css` |
| Deliverable | `docs/DESIGN.md` (single source of truth), `tokens.css` siap dipakai Vue |
| Done jika | Semua pasangan fg/bg lolos kontras 4.5:1 (teks) / 3:1 (UI besar); token dipakai penuh tanpa hardcode warna |

### D1 — Mobile User App (layar inti)
| | |
|---|---|
| Skills | `frontend-design`, `platform-design`, `login-flow` |
| Kerja | Layar 1, 2, 3, 6, 7 (HTML mockup fidelity tinggi ATAU langsung komponen Vue — lihat §6) — mobile-first, material-informed |
| Deliverable | Mockup/komponen layar 1–3, 6–7 + states |
| Done jika | Tap target ≥44px; 390px & 360px rapi; desktop browser ter-batasi 480px terpusat; states lengkap |

### D2 — Layar Scan "AR" (signature)
| | |
|---|---|
| Skills | `frontend-dev` (bagian animasi saja; **abaikan dependensi MiniMax API**), `impeccable-design-polish` |
| Kerja | Overlay frame scan (garis sudut, sweep beranimasi, grid), panel hasil "AR" (slide-up + stagger), shutter & flash feedback, permission state |
| Deliverable | Mockup interaktif layar 4 (video/foto statis sebagai dummy kamera) |
| Done jika | Animasi ≤350ms & menghormati `prefers-reduced-motion`; hasil scan terbaca 1 detik pertama; panel tidak menutupi objek yang discan |

### D3 — Admin
| | |
|---|---|
| Skills | `shadcn-ui` (referensi pattern; implementasi **shadcn-vue**), `d3-visualization` ATAU `frame-data-chart-nyt` (pilih satu, panduan visual chart) |
| Kerja | Layout shell (sidebar/topbar/drawer), dashboard + chart, tabel pattern, antrian verifikasi, form pattern |
| Deliverable | Komponen admin + dashboard |
| Done jika | Angka KPI terbaca <5 detik; tabel responsif jadi kartu di mobile; konsisten token D0 |

### D4 — Review & Polish
| | |
|---|---|
| Skills | `web-design-guidelines`, `impeccable-design-polish`, `design-review` |
| Kerja | Audit menyeluruh (aksesibilitas, konsistensi, motion), perbaikan atomic commit + before/after screenshot |
| Deliverable | Laporan audit + UI final rapi |
| Done jika | Checklist guidelines lolos; tidak ada hardcoded style; screenshot before/after terdokumentasi |

**Pendukung opsional (panggil saat dibutuhkan saja):** `copywriting` + `marketing-psychology` (mikrocopy onboarding/CTA/empty state), `brandkit` (konsep logo), `faq-page` (halaman bantuan), `design-brief` (kalau arah visual perlu diformalkan lagi).

---

## 6. Format Output Desain

**Keputusan:** mockup HTML statis **hanya untuk 4 layar kritis** (Onboarding, Home, Scan, Dashboard Admin). Layar lainnya langsung komponen Vue mengikuti token — karena implementasi Vue+Capacitor sudah dipastikan, membuat mockup ganda memboroskan effort.

Struktur file hasil tahap desain:
```
docs/DESIGN.md            ← single source of truth (Fase D0)
docs/desain/              ← mockup 4 layar kritis (self-contained: inline CSS + token)
admin/src/styles/tokens.css, base.css          ← konsumsi token (dibuat saat dev, disalin dari D0)
mobile/src/styles/tokens.css, base.css         ← idem
```

---

## 7. Prompt Sesi Baru (siap pakai)

> Tempelkan salah satu ke sesi baru. Ganti tanda `[…]` bila perlu.

**D0 — Token:**
```text
Baca docs/PRD.md §4–5 dan docs/desain.md §2–3 (arah desain + token mentah dari wireframe).
Aktifkan skill design-md dan color-expert.
Tugas: audit & finalisasi design tokens Ekoteologi AR (perbaiki kontras gold/gray ke WCAG AA,
lengkapi token semantic, spasi, tipografi, motion) lalu tulis docs/DESIGN.md dan docs/desain/tokens.css.
Output hanya 2 file itu. Jangan membuat komponen.
```

**D1 — Mobile inti:**
```text
Baca docs/desain.md §2–4 dan docs/DESIGN.md. Aktifkan skill frontend-design, platform-design, login-flow.
Tugas: buat mockup HTML mobile-first (basis 390px, max-width 480px di desktop) untuk layar:
Onboarding, Auth, Home/Dashboard, Misi, E-Learning Ekoteologi AR — sesuai inventaris §4.1,
pakai token dari docs/desain/tokens.css. Sertakan state loading/empty/error. Simpan di docs/desain/mobile/.
```

**D2 — Scan AR:**
```text
Baca docs/desain.md §2–5 dan docs/DESIGN.md. Aktifkan skill frontend-dev (hanya bagian animasi —
JANGAN gunakan MiniMax API atau API eksternal apa pun) dan impeccable-design-polish.
Tugas: mockup interaktif layar Scan "AR": overlay frame scan beranimasi di atas placeholder kamera
(gambar statis), panel hasil "AR" slide-up berisi jenis sampah/kategori/poin/saran/quote,
state permission & error. Hormati prefers-reduced-motion. Simpan di docs/desain/scan.html.
```

**D3 — Admin:**
```text
Baca docs/desain.md §2–5 dan docs/DESIGN.md. Aktifkan skill shadcn-ui (sebagai referensi; implementasi
mengacu shadcn-vue) dan frame-data-chart-nyt (panduan visual chart).
Tugas: desain shell admin (sidebar/topbar/responsive drawer) + Dashboard (KPI cards + 2 chart) +
pola tabel + antrian verifikasi misi (preview gambar + aksi cepat). Browser-first desktop, tetap mobile
friendly per §4.2. Simpan di docs/desain/admin/.
```

**D4 — Review:**
```text
Baca docs/DESIGN.md dan review seluruh mockup di docs/desain/. Aktifkan skill web-design-guidelines,
impeccable-design-polish, dan design-review.
Tugas: audit menyeluruh (aksesibilitas, konsistensi token, motion, responsive), lalu perbaiki dengan
commit atomic per perbaikan + dokumentasikan before/after. Ringkas temuan & perbaikan di docs/desain/AUDIT.md.
```

---

## 8. Checklist Definition of Done (semua fase)

- [ ] Warna/font/spasi/radius/shadow 100% dari token — nol hardcode
- [ ] Kontras teks ≥4.5:1, UI besar ≥3:1 (WCAG AA)
- [ ] Tap target ≥44px (mobile), focus-visible jelas (admin/desktop)
- [ ] Loading/empty/error/offline state ada di setiap layar data
- [ ] `prefers-reduced-motion` dihormati
- [ ] Mobile app rapi di 360/390px; desktop browser ter-batasi 480px
- [ ] Admin rapi di 1280/1024/768px (tabel → kartu di mobile)
- [ ] Bahasa Indonesia untuk semua microcopy
- [ ] Tidak ada emoji sebagai ikon; konsisten FontAwesome/token ikon
