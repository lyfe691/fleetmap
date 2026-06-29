#!/usr/bin/env bash
# Pull latest code and rebuild the prod stack on the VPS.
#   ./redeploy.sh   (run from /opt/fleetmap)
set -euo pipefail

cd "$(dirname "$0")"

compose="docker compose -f docker-compose.prod.yml"

echo "==> git pull"
git pull --ff-only

echo "==> build & up"
$compose up -d --build

echo "==> status"
$compose ps
