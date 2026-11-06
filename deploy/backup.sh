#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/apps/telegram-channel-matrix
mkdir -p backups
backup="backups/matrix-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec telegram-postgres pg_dump -U matrix_owner -d telegram_channel_matrix -Fc > "$backup.tmp"
test -s "$backup.tmp"
mv "$backup.tmp" "$backup"
sha256sum "$backup" > "$backup.sha256"
find backups -maxdepth 1 -type f -name 'matrix-*.dump*' -mtime +14 -delete
