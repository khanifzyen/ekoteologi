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

## Perintah

```bash
npm ci
npm run dev        # http://localhost:5174
npm run lint       # eslint (flat config)
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
├── components/ui/      # komponen inti (Story Sprint 0)
├── layouts/AdminShell  # sidebar + topbar + drawer (mockup index.html)
├── router/index.ts     # rute + role guard
├── stores/             # auth (sesi+role), toast
├── styles/             # tokens.css (salinan docs/desain), admin.css (mockup), app.css (tambahan)
└── views/              # LoginView, DashboardView (placeholder — KPI Sprint 3–4)
```

Catatan: modul menu lain (Pengguna, Verifikasi, Misi, dst.) sengaja nonaktif dengan toast
"menyusul" sesuai peta sprint; item Fase 2 diberi tanda *Segera* seperti mockup.
