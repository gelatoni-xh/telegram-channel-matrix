#!/usr/bin/env bash
set -euo pipefail
cd /opt/apps/telegram-channel-matrix
exec docker exec -i telegram-postgres psql -U matrix_app -d telegram_channel_matrix -Atq -f /opt/apps/telegram-channel-matrix/deploy/export-channel-stats.sql
