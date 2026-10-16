#!/usr/bin/env bash
# Memperbarui server ke kode terbaru di branch yang sedang aktif.
#
#   ./deploy/deploy.sh            # tarik kode, build, migrasi, restart
#   ./deploy/deploy.sh --no-pull  # build ulang dari kode yang sudah ada
#
# Migrasi database jalan otomatis (layanan "migrate") sebelum aplikasi naik.
set -euo pipefail
cd "$(dirname "$0")/.."

compose() { docker compose -f deploy/compose.yml "$@"; }

if [[ ! -f deploy/.env ]]; then
  echo "deploy/.env belum ada. Salin dari deploy/.env.example lalu isi." >&2
  exit 1
fi

if [[ "${1:-}" != "--no-pull" ]]; then
  git pull --ff-only
fi

echo "==> Versi: $(git log -1 --format='%h %s')"
compose build
compose up -d --remove-orphans
compose ps

# Image lama yang tidak dipakai lagi.
docker image prune -f >/dev/null
