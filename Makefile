# Perintah harian monorepo Ekoteologi AR (lihat README.md).
# Backend = PocketBase v0.40.3 (pin — keputusan M1). Ubah PB_VERSION di sini,
# di pocketbase/Dockerfile, dan .github/workflows/ci.yml secara bersamaan.
PB_VERSION := 0.40.3
PB_ARCH := $(shell uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

.PHONY: help pb-install pb-serve pb-superuser pb-test pb-e2e pb-smoke \
        admin-install admin-dev admin-build mobile-install mobile-dev mobile-build apk

help:
	@grep -E '^[a-zA-Z_-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "%-16s %s\n", $$1, $$2}'

# ── Backend (PocketBase) ──
pb-install: ## Unduh binary PocketBase v$(PB_VERSION) ke pocketbase/
	curl -sL -o /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v$(PB_VERSION)/pocketbase_$(PB_VERSION)_linux_$(PB_ARCH).zip" \
		&& unzip -o -q /tmp/pb.zip -d pocketbase && chmod +x pocketbase/pocketbase && rm /tmp/pb.zip
pb-serve: ## Serve PocketBase lokal (http://127.0.0.1:8090, dashboard /_/)
	cd pocketbase && ./pocketbase serve
pb-superuser: ## Buat/perbarui superuser dari env PB_SUPERUSER_* (default admin@ekoteologi.id/ekoteologi123)
	cd pocketbase && ./pocketbase superuser upsert "$${PB_SUPERUSER_EMAIL:-admin@ekoteologi.id}" "$${PB_SUPERUSER_PASSWORD:-ekoteologi123}"
pb-test: ## Verifikasi skema + seed + rules + audit (instance uji sekali pakai; butuh pb-install)
	node pocketbase/scripts/test.mjs
pb-e2e: ## E2E alur klien SDK (auth/profil/misi/verifikasi) terhadap instance uji; butuh pb-install
	node pocketbase/scripts/e2e-sdk.mjs
pb-smoke: ## Smoke: boot instance uji + cek /api/health & /api/ekoteologi/ping (butuh pb-install)
	node pocketbase/scripts/smoke.mjs

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
