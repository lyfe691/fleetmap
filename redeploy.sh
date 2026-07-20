#!/usr/bin/env bash
# Pull latest code and restart the prod stack on the VPS.
#   ./redeploy.sh   (run from /opt/fleetmap)
#
# Images are BUILT LOCALLY and shipped — the 4GB box cannot build while
# running both stacks (see docs/deployment.md "Deploying new code").
set -euo pipefail

cd "$(dirname "$0")"

compose="docker compose -f docker-compose.prod.yml"

echo "==> git pull"
git pull --ff-only

if [ -f fleetmap-images.tar.gz ]; then
  echo "==> load shipped images"
  docker load < fleetmap-images.tar.gz
  rm fleetmap-images.tar.gz
fi

echo "==> up (no build)"
$compose up -d --no-build

echo "==> status"
$compose ps
