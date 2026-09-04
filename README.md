# Ekoteologi AR — Monorepo

MVP Ekoteologi AR: aplikasi mobile (Android) scan sampah berbasis AI + panel admin.
Rencana eksekusi: [`docs/implementation-plan.md`](docs/implementation-plan.md) (Scrum, 9 sprint).
Sumber desain: [`docs/DESIGN.md`](docs/DESIGN.md) + mockup `docs/desain/`.

## Struktur

| Folder | Isi | Stack |
|---|---|---|
| `api/` | Backend REST + LLM adapter (Sprint 2+) | FastAPI, SQLAlchemy 2 (async), PostgreSQL, Redis, Alembic |
| `admin/` | Panel admin | Vue 3 + Vite + TS, Pinia, Vue Router |
| `mobile/` | User app (Android) | Vue 3 + Vite + TS, Capacitor |
| `docs/` | PRD, design system, mockup D0–D4, rencana sprint | — |

## Prasyarat

- Node ≥ 24, Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/), Docker
- Untuk build APK: Android SDK (platform 35/36) + JDK 21 (lihat `mobile/README.md`)

## Mulai cepat

```bash
docker compose up -d        # Postgres (host 55432) + Redis (host 56379)

make api-install && make api-migrate    # dependensi + skema DB
make api-run                            # API di http://localhost:8100/docs

make admin-install && make admin-dev    # admin di http://localhost:5174
make mobile-install && make mobile-dev  # web mobile di http://localhost:5173
```

User admin awal: `cd api && uv run python -m scripts.create_admin` (kredensial via env
`ADMIN_EMAIL`/`ADMIN_PASSWORD`, default `admin@ekoteologi.id` / `ekoteologi123`).

> Port 5432/6379/8000 sengaja dihindari di compose lokal karena sering terpakai
> layanan lain di mesin dev; pemetaan bisa diubah di `docker-compose.yml`.

## Konvensi penting

- **Desain**: semua warna/jarak/ukuran dari `src/styles/tokens.css` (hasil salinan
  `docs/desain/tokens.css` — satu sumber di docs; perubahan token disalin ke kedua app dan
  dicatat di PR). Tanpa emoji sebagai ikon — FontAwesome 6.
- **Config**: via environment saja (`.env.example` di setiap app). API key LLM tidak pernah
  hardcode dan app tidak pernah memanggil LLM langsung (selalu via API).
- **Poin** = ledger append-only (`point_transactions`); `users.points` hanya cache.
- **CI** (`.github/workflows/ci.yml`): lint + test API (Postgres/Redis service), lint + build
  admin & mobile, dan build APK debug sebagai artefak.

## Perintah harian

Lihat `make help` (daftar target di `Makefile`) dan README masing-masing app
(`api/README.md`, `admin/README.md`, `mobile/README.md`).
