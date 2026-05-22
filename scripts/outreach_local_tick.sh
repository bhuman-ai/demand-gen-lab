#!/usr/bin/env bash
set -euo pipefail
cd /opt/lastb2b
if [ -f .env.local ]; then
  set -a
  . ./.env.local
  set +a
fi
export DISPLAY="${DISPLAY:-:99}"
export XAUTHORITY="${XAUTHORITY:-/root/.Xauthority}"
npx tsx scripts/outreach_local_tick.ts "$@"
