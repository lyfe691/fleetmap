#!/bin/sh
set -eu
mkdir -p /opt/fleetmap-backups
docker compose -f /opt/fleetmap/supabase-docker/docker-compose.yml exec -T db pg_dump -U postgres postgres | gzip > "/opt/fleetmap-backups/fleetmap-$(date +%F).sql.gz"
find /opt/fleetmap-backups -name 'fleetmap-*.sql.gz' -mtime +14 -delete
