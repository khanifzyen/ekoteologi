#!/bin/sh
# Entrypoint PocketBase Ekoteologi: inisialisasi superuser dari env lalu exec serve.
# (PB v0.40 tidak lagi membuat superuser otomatis dari env saat serve.)
set -e

if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" || true
fi

exec pocketbase "$@"
