# Ekoteologi AR — Monorepo

MVP Ekoteologi AR: aplikasi mobile (Android) scan sampah berbasis AI + panel admin.
Rencana eksekusi: [`docs/implementation-plan.md`](docs/implementation-plan.md) —
Sprint 0–8 (MVP) dieksekusi dengan FastAPI (riwayat: tag git `fastapi-archive`);
sejak **Sprint 9** backend = **PocketBase** (migrasi Sprint 9–13).
Sumber desain: [`docs/DESIGN.md`](docs/DESIGN.md) + mockup `docs/desain/`.

## Struktur

| Folder | Isi | Stack |
|---|---|---|
| `pocketbase/` | Backend: koleksi, rules, hooks JSVM, migrasi skema + seed | PocketBase v0.40.3 (pin), `pb_migrations` + `pb_hooks` |
| `admin/` | Panel admin | Vue 3 + Vite + TS, Pinia, Vue Router |
| `mobile/` | User app (Android) | Vue 3 + Vite + TS, Capacitor |
| `docs/` | PRD, design system, mockup D0–D4, rencana sprint | — |

## Prasyarat

- Node ≥ 24, curl + unzip (untuk `make pb-install`), Docker (opsional — atau binary langsung)
- Untuk build APK: Android SDK (platform 35/36) + JDK 21 (lihat `mobile/README.md`)

## Mulai cepat

```bash
make pb-install && make pb-superuser   # binary + superuser dari env PB_SUPERUSER_*
make pb-serve                          # backend di http://127.0.0.1:8090 (dashboard /_/)
make pb-test                           # verifikasi skema + seed + rules

# opsional via Docker:
docker compose up -d                   # PocketBase di http://localhost:56180

make admin-install && make admin-dev   # admin di http://localhost:5174
make mobile-install && make mobile-dev # web mobile di http://localhost:5173
```

> Admin & mobile belum beralih ke SDK PocketBase — itu Sprint 10 (implementation-plan §5).
> Kontrak backend: [`pocketbase/README.md`](pocketbase/README.md).

## Konvensi penting

- **Desain**: semua warna/jarak/ukuran dari `src/styles/tokens.css` (hasil salinan
  `docs/desain/tokens.css` — satu sumber di docs; perubahan token disalin ke kedua app dan
  dicatat di PR). Tanpa emoji sebagai ikon — FontAwesome 6.
- **Config**: via environment saja (`.env.example` per app). Key LLM tidak pernah hardcode
  dan app tidak pernah memanggil LLM langsung (selalu via backend — hook scan, Sprint 11).
- **Poin** = ledger append-only (`point_transactions`); `users.points` hanya cache.
- **Versi PocketBase di-pin** (pre-1.0): `Makefile`, `pocketbase/Dockerfile`,
  `.github/workflows/ci.yml` diubah bersamaan; upgrade terjadwal + `make pb-test`.
- **CI** (`.github/workflows/ci.yml`): job `backend` (lint JS hooks/migrations + instance
  uji PocketBase + smoke), lint + build admin & mobile, dan build APK debug sebagai artefak.

## Perintah harian

Lihat `make help` (daftar target di `Makefile`) dan README masing-masing app
(`pocketbase/README.md`, `admin/README.md`, `mobile/README.md`).
