#!/usr/bin/env bash
set -euo pipefail
cd /opt/apps/telegram-channel-matrix
query="$(< /opt/apps/telegram-channel-matrix/deploy/export-channel-stats.sql)"
exec docker exec -i telegram-postgres psql -U matrix_app -d telegram_channel_matrix -Atq -c "$query"
