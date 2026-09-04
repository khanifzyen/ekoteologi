# Perintah harian monorepo Ekoteologi AR (lihat README.md).
.PHONY: help db-up db-down api-install api-lint api-test api-migrate api-seed api-run \
        admin-install admin-dev admin-build mobile-install mobile-dev mobile-build apk

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-16s %s\n", $$1, $$2}'

# ── Infrastruktur ──
db-up: ## Nyalakan Postgres + Redis (docker compose)
	docker compose up -d
db-down: ## Matikan layanan lokal
	docker compose down

# ── API (FastAPI) ──
api-install: ## Sinkronisasi dependensi API (uv)
	cd api && uv sync
api-lint: ## Lint + cek format API
	cd api && uv run ruff check . && uv run ruff format --check .
api-test: ## Jalankan test API (butuh db-up)
	cd api && uv run pytest
api-migrate: ## Terapkan migrasi Alembic
	cd api && uv run alembic upgrade head
api-seed: ## Seed data awal (kategori sampah, level, badge) — idempoten
	cd api && uv run python -m scripts.seed
api-run: ## Jalankan API lokal (uvicorn, auto-reload)
	cd api && uv run uvicorn app.main:app --reload --port 8000

# ── Admin (Vue) ──
admin-install:
	cd admin && npm ci
admin-dev: ## Dev server admin (Vite)
	cd admin && npm run dev
admin-build: ## Build produksi admin
	cd admin && npm run build

# ── Mobile (Vue + Capacitor) ──
mobile-install:
	cd mobile && npm ci
mobile-dev: ## Dev server web mobile (Vite)
	cd mobile && npm run dev
mobile-build: ## Build web assets mobile
	cd mobile && npm run build
apk: ## Build APK debug Android (butuh Android SDK)
	cd mobile && npm run build && npx cap sync android && cd android && ./gradlew assembleDebug
