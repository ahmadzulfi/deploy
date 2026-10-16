# syntax=docker/dockerfile:1

# Satu image untuk web, webhook, worker, dan migrasi. Keempatnya berbagi
# @wa/core dan @wa/db yang dijalankan sebagai TypeScript mentah lewat tsx,
# persis seperti saat development - yang beda hanya perintah di compose.
#
# Layanan Go (apps/ai-knowledge) punya Dockerfile sendiri.

FROM node:24-bookworm-slim AS base
# Prisma butuh openssl untuk memilih engine yang cocok.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Versinya sama dengan "packageManager" di package.json.
RUN npm install -g pnpm@9.12.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
# Unduh paket hanya dari lockfile dulu, supaya layer ini tetap ter-cache
# selama dependensi tidak berubah walau kode berubah.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm fetch --frozen-lockfile --store-dir /pnpm-store

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm-store
RUN cd packages/db && ./node_modules/.bin/prisma generate

# next build mengimpor modul server; nilai palsu ini hanya supaya impor itu
# tidak gagal. Nilai sebenarnya datang dari compose saat container jalan.
RUN cd apps/web \
 && DATABASE_URL=postgresql://build:build@localhost:5432/build \
    REDIS_URL=redis://localhost:6379 \
    ENCRYPTION_KEY=build AUTH_SECRET=build \
    ./node_modules/.bin/next build

FROM base
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
