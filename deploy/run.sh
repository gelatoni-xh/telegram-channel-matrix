#!/usr/bin/env bash
set -euo pipefail
cd /opt/apps/telegram-channel-matrix
date -u +%s > data/service-started-at
exec /usr/bin/docker compose --env-file .env --env-file release.env run --rm --name telegram-channel-matrix-daily worker
