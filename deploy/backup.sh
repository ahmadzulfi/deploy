#!/usr/bin/env bash
# Cadangan database ke deploy/backups/, menyimpan 14 hari terakhir.
#
# Jadwalkan tiap malam (crontab -e):
#   30 1 * * * /path/ke/claudewa/deploy/backup.sh >> /var/log/claudewa-backup.log 2>&1
#
# pg_dump dijalankan dari container Postgres 18 (versinya harus minimal sama
# dengan server database), memakai AI_DATABASE_URL di deploy/.env karena URL
# itu tidak membawa parameter khusus Prisma yang ditolak pg_dump.
#
# Cara memulihkan ada di README bagian "Jadwalkan cadangan".
#
# ENCRYPTION_KEY di deploy/.env TIDAK ikut tercadang di sini. Simpan
# salinannya terpisah: tanpa kunci itu token nomor WA di cadangan tidak terbaca.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
. deploy/.env
set +a

mkdir -p deploy/backups
file="deploy/backups/claudewa-$(date +%Y%m%d-%H%M%S).dump"

if [[ "${COMPOSE_PROFILES:-}" == *db-lokal* ]]; then
  # Postgres di container compose: nama host "postgres" hanya dikenal di
  # jaringan compose, jadi dump dari dalam container itu sendiri.
  docker compose -f deploy/compose.yml exec -T postgres \
    pg_dump -U wa -Fc --no-owner --no-acl wa_platform > "$file"
else
  docker run --rm -e PGURL="$AI_DATABASE_URL" postgres:18-alpine \
    sh -c 'pg_dump -Fc --no-owner --no-acl "$PGURL"' > "$file"
fi
echo "$(date -Is) cadangan: $file ($(du -h "$file" | cut -f1))"

find deploy/backups -name 'claudewa-*.dump' -mtime +14 -delete
