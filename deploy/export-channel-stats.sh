#!/usr/bin/env bash
set -euo pipefail
cd /opt/apps/telegram-channel-matrix
query="$(< /opt/apps/telegram-channel-matrix/deploy/export-channel-stats.sql)"
history="$(docker exec -i telegram-postgres psql -U matrix_app -d telegram_channel_matrix -Atq -c "$query")"
current="$(docker compose --env-file .env --env-file release.env run --rm --no-deps worker node dist/src/export-channel-counts.js)"
export CHANNEL_HISTORY_JSON="$history" CHANNEL_CURRENT_JSON="$current"
python3 -c 'import json, os; report=json.loads(os.environ["CHANNEL_HISTORY_JSON"]); report["currentSnapshot"]=json.loads(os.environ["CHANNEL_CURRENT_JSON"]); print(json.dumps(report, separators=(",", ":")))'
