#!/usr/bin/env bash
set -euo pipefail
if [[ "${SERVICE_RESULT:-success}" == success ]]; then exit 0; fi
cd /opt/apps/telegram-channel-matrix
/usr/bin/docker compose --env-file .env --env-file release.env run --rm worker python3 scripts/service-failure-report.py
