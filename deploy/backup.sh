#!/usr/bin/env bash
# Cadangan database ke deploy/backups/, menyimpan 14 hari terakhir.
#
# Jadwalkan tiap malam (crontab -e):
#   30 1 * * * /path/ke/claudewa/deploy/backup.sh >> /var/log/claudewa-backup.log 2>&1
#
# Pulihkan:
#   docker compose -f deploy/compose.yml exec -T postgres \
#     pg_restore -U wa -d wa_platform --clean --if-exists < deploy/backups/<file>.dump
#
# ENCRYPTION_KEY di deploy/.env TIDAK ikut tercadang di sini. Simpan
# salinannya terpisah: tanpa kunci itu token nomor WA di cadangan tidak terbaca.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p deploy/backups
file="deploy/backups/wa_platform-$(date +%Y%m%d-%H%M%S).dump"

docker compose -f deploy/compose.yml exec -T postgres pg_dump -U wa -Fc wa_platform > "$file"
echo "$(date -Is) cadangan: $file ($(du -h "$file" | cut -f1))"

find deploy/backups -name 'wa_platform-*.dump' -mtime +14 -delete
