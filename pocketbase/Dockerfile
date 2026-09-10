# PocketBase Ekoteologi — satu binary, versi di-pin (keputusan M1, implementation-plan §2.1).
# Build: docker compose build pocketbase  (atau docker build -t ekoteologi-pocketbase .)
ARG PB_VERSION=0.40.3
FROM alpine:3.20 AS runtime
ARG PB_VERSION
ARG PB_ARCH=amd64

RUN apk add --no-cache ca-certificates unzip curl

# Unduh binary versi pin (penamaan aset resmi: pocketbase_<versi>_<os>_<arch>.zip)
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip /tmp/pb.zip
RUN unzip -o /tmp/pb.zip -d /usr/local/bin && chmod +x /usr/local/bin/pocketbase && rm /tmp/pb.zip

# Skema (pb_migrations) & hook (pb_hooks) ikut image; data di volume.
WORKDIR /pb
COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks

# Inisialisasi superuser via env (PB_SUPERUSER_EMAIL/PB_SUPERUSER_PASSWORD) sebelum serve.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8090
VOLUME /pb/pb_data

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8090/api/health > /dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve", "--http", "0.0.0.0:8090"]
