#!/usr/bin/env bash
# Pull the latest code + images and restart the prod stack on the server.
#   ./redeploy.sh   (run from /opt/fleetmap)
#
# Images come from ghcr.io (built by GitHub Actions on every push to main);
# the server never builds (see docs/deployment.md "Deploying new code").
set -euo pipefail
{
cd "$(dirname "$0")"

compose="docker compose -f docker-compose.prod.yml"

for var in FLEET_HOST SUPABASE_HOST; do
  grep -Eq "^${var}=.+" .env || { echo "STOP: set ${var} in .env (Caddy site address)" >&2; exit 1; }
done

echo "==> git pull"
git pull --ff-only

echo "==> pull images"
$compose pull --quiet app sync driver-session

echo "==> up (no build)"
$compose up -d --no-build

# The Caddyfile is bind-mounted, so `up` leaves a running Caddy on its old
# config and new routes 404 into the app. Reload it every time.
echo "==> reload caddy config"
$compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile   || $compose restart caddy

echo "==> prune old images"
docker image prune -f >/dev/null

echo "==> status"
$compose ps
exit 0
}
