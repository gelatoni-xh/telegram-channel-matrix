#!/usr/bin/env bash
set -euo pipefail
cd /opt/apps/telegram-channel-matrix
stage=database_history
trap 'status=$?; printf "[channel-stats] remote_stage=%s exitCode=%s\n" "$stage" "$status" >&2' ERR
query="$(< /opt/apps/telegram-channel-matrix/deploy/export-channel-stats.sql)"
history="$(docker exec -i telegram-postgres psql -U matrix_app -d telegram_channel_matrix -Atq -c "$query")"
stage=current_subscribers
current="$(docker compose --env-file .env --env-file release.env run --rm --no-deps worker node dist/src/export-channel-counts.js)"
export CHANNEL_HISTORY_JSON="$history" CHANNEL_CURRENT_JSON="$current"
stage=json_assembly
python3 -c 'import json, os; report=json.loads(os.environ["CHANNEL_HISTORY_JSON"]); report["currentSnapshot"]=json.loads(os.environ["CHANNEL_CURRENT_JSON"]); print(json.dumps(report, separators=(",", ":")))'
