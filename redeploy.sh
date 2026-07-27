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

# The Caddyfile is bind-mounted, so `up` leaves a running Caddy on its old
# config and new routes 404 into the app. Reload it every time.
echo "==> reload caddy config"
$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
  || $compose restart caddy

echo "==> status"
$compose ps
