#!/usr/bin/env bash
# Fresh Fleetmap host bring-up. Run as root ON THE NEW SERVER, one phase at a time:
#
#   bash box-bringup.sh prep  <FLEET_HOST> <SUPABASE_HOST> [OSRM_SOURCE_HOST]
#   bash box-bringup.sh up
#   bash box-bringup.sh smoke
#
# prep   prerequisites, clone, edge network, OSRM dataset (copied from
#        OSRM_SOURCE_HOST over ssh if given, otherwise built). Idempotent.
# up     starts the Supabase stack and Caddy once the three env files exist.
# smoke  the docs/deployment.md §9 checks against the live hostnames.
#
# First run (no clone yet):
#   curl -fsSL https://raw.githubusercontent.com/lyfe691/fleetmap/main/scripts/box-bringup.sh -o box-bringup.sh
set -euo pipefail

REPO=https://github.com/lyfe691/fleetmap.git
DIR=/opt/fleetmap
OSRM_IMAGE=osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409
PBF=https://download.geofabrik.de/europe/switzerland-latest.osm.pbf

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
env_get() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2-; }

phase=${1:-}
case "$phase" in
  prep)
    FLEET_HOST=${2:-}; SUPABASE_HOST=${3:-}; OSRM_SRC=${4:-}
    [ -n "$FLEET_HOST" ] && [ -n "$SUPABASE_HOST" ] || die "usage: box-bringup.sh prep <FLEET_HOST> <SUPABASE_HOST> [OSRM_SOURCE_HOST]"
    [ "$(id -u)" = 0 ] || die "run as root"

    say "docker"
    docker --version && docker compose version || die "install Docker with the compose plugin first"

    say "packages"
    apt-get install -y -q git rsync curl dnsutils >/dev/null

    say "swap"
    if ! swapon --show | grep -q /swapfile; then
      fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
      grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    free -m | head -2

    say "firewall"
    if ufw status 2>/dev/null | grep -q '^Status: active'; then
      ufw allow 80,443/tcp >/dev/null && ufw reload >/dev/null
    fi

    say "dns"
    public_ip=$(curl -fsS -4 https://ifconfig.me || true)
    for h in "$FLEET_HOST" "$SUPABASE_HOST"; do
      resolved=$(dig +short "$h" | tail -1)
      printf '%s -> %s' "$h" "${resolved:-<unresolved>}"
      [ -n "$public_ip" ] && [ "$resolved" = "$public_ip" ] && printf '  (matches this box)'
      printf '\n'
    done
    printf 'this box: %s\n' "${public_ip:-<unknown>}"

    say "repo"
    if [ -d "$DIR/.git" ]; then
      git -C "$DIR" pull --ff-only
    else
      git clone "$REPO" "$DIR"
    fi

    say "edge network"
    docker network inspect fleetmap-edge >/dev/null 2>&1 || docker network create fleetmap-edge

    say "osrm dataset"
    mkdir -p "$DIR/osrm"
    if [ -f "$DIR/osrm/switzerland-latest.osrm.mldgr" ]; then
      echo "present"
    elif [ -n "$OSRM_SRC" ]; then
      echo "copying from $OSRM_SRC (you will be asked for its password)"
      rsync -a --info=progress2 "root@$OSRM_SRC:/opt/fleetmap/osrm/" "$DIR/osrm/"
    else
      echo "building (~15 min)"
      [ -f "$DIR/osrm/switzerland-latest.osm.pbf" ] || wget -q --show-progress "$PBF" -P "$DIR/osrm"
      docker run --rm -t -v "$DIR/osrm:/data" "$OSRM_IMAGE" osrm-extract -p /opt/car.lua /data/switzerland-latest.osm.pbf
      docker run --rm -t -v "$DIR/osrm:/data" "$OSRM_IMAGE" osrm-partition /data/switzerland-latest.osrm
      docker run --rm -t -v "$DIR/osrm:/data" "$OSRM_IMAGE" osrm-customize /data/switzerland-latest.osrm
    fi

    say "prep done"
    cat <<EOF
Next: copy the three env files here, then run the 'up' phase.
  $DIR/supabase-docker/.env
  $DIR/.env
  $DIR/.env.driver-session
EOF
    ;;

  up)
    cd "$DIR" || die "$DIR missing; run prep first"
    for f in supabase-docker/.env .env .env.driver-session; do
      [ -s "$f" ] || die "missing $f"
    done
    chmod 600 .env .env.driver-session supabase-docker/.env
    for v in FLEET_HOST SUPABASE_HOST NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; do
      [ -n "$(env_get .env "$v")" ] || die "$v empty in .env"
    done
    for v in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY SITE_URL API_EXTERNAL_URL SUPABASE_PUBLIC_URL; do
      [ -n "$(env_get supabase-docker/.env "$v")" ] || die "$v empty in supabase-docker/.env"
    done
    for v in SUPABASE_SECRET_KEY BB_API_URL BB_API_USERNAME BB_API_PASSWORD; do
      [ -n "$(env_get .env.driver-session "$v")" ] || echo "note: $v empty in .env.driver-session (driver-session will not start until set)"
    done

    say "supabase stack"
    docker compose -f supabase-docker/docker-compose.yml up -d
    for _ in $(seq 1 30); do
      unhealthy=$(docker compose -f supabase-docker/docker-compose.yml ps --format '{{.Service}} {{.Status}}' | grep -vc 'healthy\|Up ' || true)
      [ "$unhealthy" = 0 ] && break
      sleep 5
    done
    docker compose -f supabase-docker/docker-compose.yml ps --format 'table {{.Service}}\t{{.Status}}'

    say "caddy"
    docker compose -f docker-compose.prod.yml up -d caddy
    SUPABASE_HOST=$(env_get .env SUPABASE_HOST)
    ANON=$(env_get supabase-docker/.env ANON_KEY)
    for _ in $(seq 1 24); do
      if curl -fsS -m 10 -H "apikey: $ANON" "https://$SUPABASE_HOST/auth/v1/health" >/dev/null 2>&1; then break; fi
      sleep 5
    done
    curl -sS -m 10 -H "apikey: $ANON" "https://$SUPABASE_HOST/auth/v1/health" || die "auth health not reachable over TLS yet; check DNS and 'docker compose -f docker-compose.prod.yml logs caddy'"

    say "up done"
    cat <<EOF

Next, from the dev machine: migrations + identities through a tunnel you open here
  ssh -N -L 6544:127.0.0.1:5432 root@$(env_get .env FLEET_HOST)
then the three images (docs/deployment.md §7), scp the tar to $DIR/, and run ./redeploy.sh
EOF
    ;;

  smoke)
    cd "$DIR" || die "$DIR missing"
    FLEET_HOST=$(env_get .env FLEET_HOST); SUPABASE_HOST=$(env_get .env SUPABASE_HOST)
    ANON=$(env_get supabase-docker/.env ANON_KEY)
    fail=0
    check() { # name expected actual
      if [ "$2" = "$3" ]; then printf 'PASS %s\n' "$1"; else printf 'FAIL %s (expected %s, got %s)\n' "$1" "$2" "$3"; fail=1; fi
    }
    check "edge (landing)"   200 "$(curl -s -o /dev/null -w '%{http_code}' -m 15 "https://$FLEET_HOST/")"
    check "ingest rejects anon" 401 "$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST "https://$FLEET_HOST/api/location" -H 'Content-Type: application/json' -d '{"lat":47.37,"lng":8.54,"recorded_at":"2026-06-25T00:00:00Z"}')"
    check "supabase auth"    200 "$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H "apikey: $ANON" "https://$SUPABASE_HOST/auth/v1/health")"
    rest=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H "apikey: $ANON" "https://$SUPABASE_HOST/rest/v1/")
    case "$rest" in 200|403) printf 'PASS supabase rest (%s)\n' "$rest" ;; *) printf 'FAIL supabase rest (got %s)\n' "$rest"; fail=1 ;; esac
    check "driver-session liveness" '{"ok":true}' "$(curl -s -m 15 "https://$FLEET_HOST/api/driver-session")"
    check "driver-session preflight" 204 "$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X OPTIONS -H 'Origin: https://rider-proof.invalid' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' "https://$FLEET_HOST/api/driver-session")"
    check "driver-session rejects junk" 401 "$(curl -s -o /dev/null -w '%{http_code}' -m 30 -X POST "https://$FLEET_HOST/api/driver-session" -H 'Content-Type: application/json' -d '{"token":"not-a-jwt"}')"
    check "osrm from app"    200 "$(docker compose -f docker-compose.prod.yml exec -T app node -e "fetch('http://osrm:5000/route/v1/driving/8.5,47.3;8.55,47.35').then(r=>console.log(r.status))" 2>/dev/null | tail -1)"
    health=$(curl -s -m 15 "https://$FLEET_HOST/api/health")
    printf 'health: %s\n' "$health"
    case "$health" in *'"ok":true'*) printf 'PASS health\n' ;; *) printf 'FAIL health\n'; fail=1 ;; esac
    say "cron"
    if crontab -l 2>/dev/null | grep -q backup.sh; then echo "backup cron present"; else
      (crontab -l 2>/dev/null; echo "10 2 * * * sh $DIR/supabase-docker/backup.sh") | crontab -
      echo "backup cron installed"
    fi
    [ "$fail" = 0 ] && say "smoke passed" || die "smoke failed"
    ;;

  *)
    sed -n '2,15p' "$0"; exit 2 ;;
esac
