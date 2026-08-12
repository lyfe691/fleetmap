# Fleetmap — VPS Deployment

Deploying fleetmap to the VPS (`fleet.ysz.life`, Ubuntu 24.04, 4GB RAM, `/opt/fleetmap`).

## What actually gets deployed

Two independent Docker Compose stacks share the box: the **app stack** and the
**Supabase stack**. Supabase used to be managed cloud; it's now self-hosted
here too — same box, its own compose project, fronted by the same Caddy.

```
phone / browser ──HTTPS──> Caddy (:443) ──> Next app (:3000) ──> Supabase (self-hosted, same box)
                              │                    └──> OSRM (:5000, internal)
                              └──> Kong (:8000, internal) ──> auth / rest / realtime / meta / studio
```

- **Caddy** — reverse proxy, free Let's Encrypt certs for both hostnames. One
  container, joined to both stacks' networks.
- **Next app** — the dashboard + API routes, standalone Docker image.
- **OSRM** — routing engine, Switzerland extract, internal-only.
- **sync** — Bubble Box route sync worker, internal-only (no port). Polls
  their API and mirrors rider routes into orders/stops via
  `PUT /api/ingest/vehicle-routes`. Needs `BB_API_URL` + `BB_API_USERNAME` +
  `BB_API_PASSWORD` in `/opt/fleetmap/.env` (empty = the service exits on
  boot until they're set). Map each van once:
  `update vehicles set rider_ref = '<numeric rider id>' where id = …`.
- **driver-session** — the Bubble Box token exchange, internal-only on `:3100`,
  reached through the single Caddy route `/api/driver-session`. It is the only
  sanctioned holder of the Supabase secret key outside `scripts/`, so its
  secrets live in their own `.env.driver-session` (§6) and never enter the app
  container. Contract: `docs/driver-session-api.md`.
- **Supabase stack** (`supabase-docker/`) — the official self-hosted compose,
  vendored into the repo (pinned, trimmed). Runs `db` (Postgres 17 +
  pg_cron), `kong` (API gateway), `auth`, `rest` (PostgREST), `realtime`,
  `meta`, `studio`, `supavisor` (connection pooler). `storage`, `imgproxy`,
  and `functions` are removed — nothing uses them.

Both stacks join the external Docker network `fleetmap-edge`, which is how
Caddy reaches Kong without publishing Kong's ports to the internet. Kong and
supavisor bind their host ports to `127.0.0.1` only — never public.

The app stack is driven by `Dockerfile`, `docker-compose.prod.yml`,
`caddy/Caddyfile`. The Supabase stack is driven by `supabase-docker/`
(vendored from `supabase/supabase`'s `docker/` — see `supabase-docker/UPSTREAM`
for the pinned commit).

Once it's up, the driver app's `API_BASE_URL` is **`https://fleet.ysz.life`**
and its Supabase URL is **`https://sb.fleet.ysz.life`**.

---

## The one rule that matters: never build on the box

The VPS has 4GB of RAM. Building the Next image while both stacks are
running has already taken prod down once (load average 91 during a `docker
build`, the app stack starved of memory and stopped answering). **Never run
`docker compose ... up -d --build` on the VPS.**

Instead: build the app images on your dev machine, ship them as a tar,
`docker load` on the VPS, `up -d --no-build`. `redeploy.sh` does the load +
up half automatically. This applies to any change that touches app code
(`app/`, `components/`, `lib/`, `workers/`, `Dockerfile`, `package.json`,
etc). Docs-only or compose-only changes (this file, `docker-compose.prod.yml`,
`caddy/Caddyfile`) don't need an image rebuild — `./redeploy.sh` alone is
enough.

---

## 0. Prerequisites on the VPS

Docker + compose already installed. Confirm, add git:

```bash
docker --version && docker compose version
apt-get install -y git
```

**Swap.** 4GB RAM with two compose stacks running is tight; give it a 2G
swapfile so a memory spike degrades instead of OOM-killing a container:

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Firewall.** Open HTTP/HTTPS if `ufw` is active (Caddy needs both — 80 is
used for the ACME challenge, then redirects to 443):

```bash
ufw status                      # if inactive, skip the next two lines
ufw allow 80,443/tcp
ufw reload
```

**DNS.** Two `A` records, both pointed at the VPS IP, before first start:

| Host | Points to |
|---|---|
| `fleet.ysz.life` | VPS IP |
| `sb.fleet.ysz.life` | VPS IP |

Confirm both resolve before bringing Caddy up:

```bash
dig +short fleet.ysz.life
dig +short sb.fleet.ysz.life
```

---

## 1. Clone the repo

```bash
cd /opt
git clone https://github.com/lyfe691/fleetmap.git
cd fleetmap
```

---

## 2. Build the OSRM dataset (one-time, ~few min)

OSRM needs a pre-processed Switzerland graph before it can serve. This
produces the files in `./osrm` that the container reads:

```bash
mkdir -p osrm
wget https://download.geofabrik.de/europe/switzerland-latest.osm.pbf -P ./osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409 osrm-extract   -p /opt/car.lua /data/switzerland-latest.osm.pbf
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409 osrm-partition           /data/switzerland-latest.osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409 osrm-customize           /data/switzerland-latest.osrm
```

Build it once; the data persists in `./osrm` across deploys and reboots.

---

## 3. Create the shared edge network (one-time)

Both compose stacks reference this network as `external`; create it before
starting either:

```bash
docker network create fleetmap-edge
```

---

## 4. Bring up the Supabase stack

**Generate secrets** (on your dev machine, not the VPS):

```bash
pnpm tsx scripts/gen-selfhost-keys.ts
```

Prints `{ jwtSecret, anonKey, serviceRoleKey }` — these become `JWT_SECRET`,
`ANON_KEY`, `SERVICE_ROLE_KEY`. Also generate:

```bash
openssl rand -hex 32   # x3, for SECRET_KEY_BASE, VAULT_ENC_KEY, PG_META_CRYPTO_KEY
```

Plus a strong `POSTGRES_PASSWORD` and `DASHBOARD_PASSWORD` (this last one
gates Studio's basic-auth login — see §9).

**Fill the env on the VPS:**

```bash
cd /opt/fleetmap/supabase-docker
cp .env.example .env
nano .env   # paste the generated values from above
```

`SITE_URL`/`API_EXTERNAL_URL`/`SUPABASE_PUBLIC_URL` are already correct in
`.env.example` (`https://fleet.ysz.life` / `https://sb.fleet.ysz.life`) —
leave them. This file never gets committed.

**Start it:**

```bash
docker compose up -d
docker compose ps   # wait for all healthy — studio can take ~30s
```

**Wire Caddy to it** (Caddy already has the `sb.fleet.ysz.life { reverse_proxy
kong:8000 }` block committed in `caddy/Caddyfile`; it just needs to join the
network and pick up the new site):

```bash
cd /opt/fleetmap && docker compose -f docker-compose.prod.yml up -d caddy
ANON=$(grep ^ANON_KEY= supabase-docker/.env | cut -d= -f2)
curl -s -H "apikey: $ANON" https://sb.fleet.ysz.life/auth/v1/health
```

Expect a GoTrue version/name JSON blob over valid TLS. (A curl without the
`apikey` header returns Kong's "No API key found" — that still proves
DNS → TLS → Kong, just not GoTrue behind it.)

---

## 5. Apply migrations + data (one-time cutover, or disaster recovery)

Schema lives in the repo (`supabase/migrations/`), never as a dump from
cloud. Run from your dev machine through an SSH tunnel — the VPS db is bound
to `127.0.0.1`, not public:

```bash
ssh -N -L 6544:127.0.0.1:5432 root@fleet.ysz.life   # leave running in one terminal
```

In another terminal:

```bash
pnpm supabase db push --db-url "postgresql://postgres.fleetmap:<POSTGRES_PASSWORD>@127.0.0.1:6544/postgres"
```

The username **must** be tenant-qualified `postgres.fleetmap` — supavisor
rejects a plain `postgres` user with "no tenant identifier". The CLI may
print a pg-delta stack trace and still have succeeded; verify with:

```bash
docker run --rm --network host postgres:17 psql "postgresql://postgres.fleetmap:<POSTGRES_PASSWORD>@127.0.0.1:6544/postgres" -tc "select version from supabase_migrations.schema_migrations order by version desc limit 5"
```

If moving data off the managed cloud project (first cutover only — the
Fleetmap prod data is already here as of 2026-07-20): dump `auth.users` +
`auth.identities` (bcrypt hashes survive, so existing logins keep working)
and the public tables, restore into the tunnel, then fix the
`vehicle_positions` id sequence. See `docs/plans/2026-07-20-supabase-local-and-selfhost.md`
(Task 10) for the exact `pg_dump`/`psql` invocations if this needs
repeating against a fresh VPS.

---

## 6. Create the app `.env` on the VPS

```bash
cd /opt/fleetmap
cp .env.example .env
nano .env
```

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://sb.fleet.ysz.life` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `ANON_KEY` from §4 |
| `SUPABASE_SECRET_KEY` | leave blank — the deployed app never needs it (dev-scripts only) |
| `OSRM_URL` | ignored here — compose overrides it to `http://osrm:5000` |
| `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` / `DASHBOARD_DISPLAY_CODE` | the TV gate identity + code |
| `DISPATCHER_EMAIL` / `DISPATCHER_PASSWORD` / `DISPATCHER_INGEST_SECRET` | dispatcher identity + ingest secret |
| `BB_API_URL` / `BB_API_USERNAME` / `BB_API_PASSWORD` | Bubble Box fleet API base + the fleet user that mints its 24 h token |

This file is read for both the build (`NEXT_PUBLIC_*` gets baked into the
client bundle — see §7) and the runtime (everything else, via `env_file` in
`docker-compose.prod.yml`).

### `.env.driver-session` — a second, separate file

The `driver-session` service deliberately does **not** read `.env`. It holds
the Supabase secret key, and a separate file is what keeps that key out of the
app container's environment.

```bash
cd /opt/fleetmap
nano .env.driver-session
chmod 600 .env.driver-session
```

| Var | Value |
|---|---|
| `SUPABASE_SECRET_KEY` | the `SERVICE_ROLE_KEY` from `supabase-docker/.env` (§4) |
| `BB_API_URL` | Bubble Box fleet API base, e.g. `https://upgrade.bubblebox.ch` |
| `BB_API_USERNAME` | the fleet API user (same credential the sync uses) |
| `BB_API_PASSWORD` | its password |

`NEXT_PUBLIC_SUPABASE_URL` is injected by compose from `.env` — don't repeat it
here.

> **Standing requirement.** Since 2026-07-29 the exchange verifies tokens by
> calling Bubble Box's `/api/v2/fleet/verify-rider-token`. Keep all four
> variables above in place before starting or recreating `driver-session`.
> With no `BB_API_*` values, the container throws `Missing env` at boot and crash-loops — and
> a crash-looping worker is exactly the failure this project has already
> missed twice. Check it started: `docker compose -f docker-compose.prod.yml
> logs --tail=20 driver-session`.
>
> The `BB_API_*` values may point at staging while Bubble Box's production
> fleet API is not live yet. Riders can then only log in if their token was
> issued by the same environment this verifies against.

> **This file must exist before the first redeploy that carries the
> `driver-session` service.** `env_file` is not optional in compose: if the
> file is missing, `docker compose up` aborts the **entire** stack, not just
> that one service. Create it first, redeploy second.

To rotate the Bubble Box fleet credentials, update the same
`BB_API_URL`, `BB_API_USERNAME`, and `BB_API_PASSWORD` values in both
`/opt/fleetmap/.env` (used by `sync`) and
`/opt/fleetmap/.env.driver-session` (used by `driver-session`). Then
force-recreate both consumers from the already-loaded images:

```bash
set -euo pipefail
cd /opt/fleetmap
chmod 600 .env .env.driver-session
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate \
  sync driver-session
docker compose -f docker-compose.prod.yml ps sync driver-session
docker compose -f docker-compose.prod.yml logs --tail=50 sync driver-session
for service in sync driver-session; do
  test -n "$(docker compose -f docker-compose.prod.yml \
    ps --status running -q "$service")" || {
    echo "STOP: $service is not running" >&2
    exit 1
  }
done
health="$(curl -fsS https://fleet.ysz.life/api/health)"
printf '%s\n' "$health"
printf '%s\n' "$health" | grep -q '"driver_session":"ok"' || {
  echo 'STOP: driver_session health is not ok' >&2
  exit 1
}
```

Stop and inspect if either container is not running, either log reports
credential/authentication failure, or health does not report
`"driver_session":"ok"`. The credentials are runtime environment, not build
arguments. Before declaring the rotation complete, wait for a post-recreate
`sync` log with `"event":"tick"`; `"event":"tick_failed"` is a failure.
Driver-session health is liveness only, so validate its rotated Bubble Box
credentials with the controlled token proof in §9.

---

## 7. Build & ship the app images (dev machine)

Images are built **locally**, never on the VPS (see "The one rule that
matters" above):

The Bubble Box verification cutover deployed in commit `530b117` on 2026-08-10
is live and requires **no database migration**. Build and ship all three images
for every subsequent application-code deploy.

```bash
docker build --platform linux/amd64 -t fleetmap-app:latest --target runner \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://sb.fleet.ysz.life \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> .
docker build --platform linux/amd64 -t fleetmap-sync:latest --target sync .
docker build --platform linux/amd64 -t fleetmap-driver-session:latest --target driver-session .
docker save fleetmap-app:latest fleetmap-sync:latest fleetmap-driver-session:latest | gzip > fleetmap-images.tar.gz

# Inspect before upload: all three tags must be present and linux/amd64.
tar -xOzf fleetmap-images.tar.gz index.json
docker image inspect fleetmap-app:latest fleetmap-sync:latest \
  fleetmap-driver-session:latest \
  --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}} {{.Id}}'

scp fleetmap-images.tar.gz root@fleet.ysz.life:/opt/fleetmap/
```

All three tags must be in the tar. `redeploy.sh` runs `up -d --no-build`, so a
service whose image is missing fails the whole `up` rather than silently
building.

The two workers are esbuild-bundled to a single `.mjs` and run on a bare
`node:22-bookworm-slim` as the non-root `node` user — no pnpm, no
`node_modules`, no TypeScript at runtime. That is what keeps them at ~327MB
instead of 1.74GB, and the whole tar under 100MB.

`--platform linux/amd64` matters if you're building on Apple Silicon or
another non-x86 dev machine — the VPS is x86_64.

---

### Driver-session diagnostic rollout and rollback

Use this procedure only to deploy the request-lifecycle diagnostics. It builds
and uploads **only** `fleetmap-driver-session:latest`; it does not run
`./redeploy.sh`, does not change the app or sync image, and never builds on the
VPS. Keep the VPS shell open through the verification so the exact rollback
path remains available. None of these commands prints `.env` contents or
tokens.

On the dev machine, build, package, and checksum the driver-session image:

```bash
set -euo pipefail
DIAGNOSTIC_TAR=fleetmap-driver-session-diagnostics.tar.gz
docker build --platform linux/amd64 -t fleetmap-driver-session:latest \
  --target driver-session .
docker image inspect fleetmap-driver-session:latest \
  --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}} {{.Id}}'
docker save fleetmap-driver-session:latest | gzip > "$DIAGNOSTIC_TAR"
sha256sum "$DIAGNOSTIC_TAR" > "$DIAGNOSTIC_TAR.sha256"
test -s "$DIAGNOSTIC_TAR"
sha256sum -c "$DIAGNOSTIC_TAR.sha256"

ssh root@fleet.ysz.life \
  'install -d -m 700 /opt/fleetmap/diagnostics-incoming /opt/fleetmap-rollbacks'
scp "$DIAGNOSTIC_TAR" "$DIAGNOSTIC_TAR.sha256" \
  root@fleet.ysz.life:/opt/fleetmap/diagnostics-incoming/
```

On the VPS, verify the upload, save the image currently tagged for
`driver-session` before replacing it, then load and recreate **only** that
service:

```bash
set -euo pipefail
cd /opt/fleetmap
INCOMING_DIR=/opt/fleetmap/diagnostics-incoming
ROLLBACK_DIR=/opt/fleetmap-rollbacks
DIAGNOSTIC_TAR="$INCOMING_DIR/fleetmap-driver-session-diagnostics.tar.gz"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLLBACK_TAR="$ROLLBACK_DIR/fleetmap-driver-session-$STAMP.tar.gz"

test -d /opt/fleetmap
test -f docker-compose.prod.yml
test -d "$INCOMING_DIR"
test -d "$ROLLBACK_DIR"
test -f "$DIAGNOSTIC_TAR"
test -f "$DIAGNOSTIC_TAR.sha256"
(cd "$INCOMING_DIR" && sha256sum -c "$(basename "$DIAGNOSTIC_TAR").sha256")
docker image inspect fleetmap-driver-session:latest \
  --format '{{index .RepoTags 0}} {{.Id}}'

docker save fleetmap-driver-session:latest | gzip > "$ROLLBACK_TAR"
sha256sum "$ROLLBACK_TAR" > "$ROLLBACK_TAR.sha256"
test -s "$ROLLBACK_TAR"
(cd "$ROLLBACK_DIR" && sha256sum -c "$(basename "$ROLLBACK_TAR").sha256")
printf 'Rollback image saved at %s\n' "$ROLLBACK_TAR"

docker load -i "$DIAGNOSTIC_TAR"
docker image inspect fleetmap-driver-session:latest \
  --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}} {{.Id}}'
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate driver-session
```

Verify startup, aggregate health, liveness, browser CORS, and malformed JSON
without sending a real token:

```bash
set -euo pipefail
cd /opt/fleetmap
test -n "$(docker compose -f docker-compose.prod.yml \
  ps --status running -q driver-session)"
docker compose -f docker-compose.prod.yml logs --tail=50 driver-session

health="$(curl -fsS https://fleet.ysz.life/api/health)"
case "$health" in
  *'"driver_session":"ok"'*) ;;
  *) echo 'STOP: driver_session health is not ok' >&2; exit 1 ;;
esac
test "$(curl -fsS https://fleet.ysz.life/api/driver-session)" = '{"ok":true}'

preflight="$(mktemp)"
trap 'rm -f "$preflight"' EXIT
curl -sS -D "$preflight" -o /dev/null -X OPTIONS \
  -H 'Origin: https://rider-proof.invalid' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' \
  https://fleet.ysz.life/api/driver-session
grep -Eiq '^HTTP/.* 204' "$preflight"
grep -Eiq '^Access-Control-Allow-Origin: \*[[:space:]]*$' "$preflight"
grep -Eiq '^Access-Control-Allow-Methods:.*POST' "$preflight"
grep -Eiq '^Access-Control-Allow-Headers:.*Content-Type' "$preflight"
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  https://fleet.ysz.life/api/driver-session \
  -H 'Content-Type: application/json' -d '{}')" = 400
```

If any check fails, do not use `./redeploy.sh`. In the same VPS shell, reload
the saved image and recreate only `driver-session`; substitute the exact path
printed by the rollout command if the shell was closed:

```bash
set -euo pipefail
cd /opt/fleetmap
# Use the exact path printed above, for example:
ROLLBACK_TAR=/opt/fleetmap-rollbacks/fleetmap-driver-session-<timestamp>.tar.gz
test -f "$ROLLBACK_TAR"
test -f "$ROLLBACK_TAR.sha256"
(cd "$(dirname "$ROLLBACK_TAR")" && sha256sum -c "$(basename "$ROLLBACK_TAR").sha256")
docker load -i "$ROLLBACK_TAR"
docker image inspect fleetmap-driver-session:latest \
  --format '{{index .RepoTags 0}} {{.Id}}'
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate driver-session
test -n "$(docker compose -f docker-compose.prod.yml \
  ps --status running -q driver-session)"
curl -fsS https://fleet.ysz.life/api/health
test "$(curl -fsS https://fleet.ysz.life/api/driver-session)" = '{"ok":true}'
```

---

## 8. First deploy

```bash
ssh root@fleet.ysz.life
cd /opt/fleetmap
./redeploy.sh
```

`redeploy.sh` git-pulls, loads `fleetmap-images.tar.gz` if present (then
deletes it), and runs `up -d --no-build` — it never invokes `docker build`.
Watch it come up:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy   # watch the cert get issued
```

Caddy logs a certificate-obtained line within a few seconds of the first
request. Then:

```bash
curl -I https://fleet.ysz.life
```

A `200`/`307` over a valid TLS cert means the edge + app are live.

---

## 9. Smoke-test the pipe

- **Dashboard:** open `https://fleet.ysz.life/dashboard`, enter the display
  code → the console loads.
- **Ingest endpoint:** an unauthenticated POST should be rejected with `401`
  (proves the route is live and auth is enforced):

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://fleet.ysz.life/api/location \
    -H 'Content-Type: application/json' -d '{"lat":47.37,"lng":8.54,"recorded_at":"2026-06-25T00:00:00Z"}'
  # expect: 401
  ```

- **Routing:** OSRM stays internal, but you can confirm it from inside the
  app container:

  ```bash
  docker compose -f docker-compose.prod.yml exec app \
    node -e "fetch('http://osrm:5000/route/v1/driving/8.5,47.3;8.55,47.35').then(r=>console.log('osrm',r.status))"
  # expect: osrm 200
  ```

- **Supabase edge:** Kong gates `/auth/v1` and `/rest/v1` behind the `apikey`
  header — a bare no-key curl to `/rest/v1/` returns "No API key found" by
  design (the un-keyed OpenAPI root is admin-only). Check it with the anon
  key instead:

  ```bash
  curl -s -H "apikey: <ANON_KEY>" https://sb.fleet.ysz.life/auth/v1/health
  curl -s -H "apikey: <ANON_KEY>" https://sb.fleet.ysz.life/rest/v1/
  # both: 200 + JSON
  ```

- **Studio:** `https://sb.fleet.ysz.life/` is fronted by Kong; Studio itself
  sits behind Kong's dashboard basic-auth (`DASHBOARD_USERNAME`/
  `DASHBOARD_PASSWORD` from `supabase-docker/.env`).

- **Health:** one endpoint covers app + Supabase + OSRM + driver-session
  liveness + sync freshness:

  ```bash
  curl -s https://fleet.ysz.life/api/health
  # {"ok":true,"supabase":"ok","osrm":"ok","driver_session":"ok","sync":null}
  # sync is null until the Bubble Box worker has run
  # 503 when supabase/osrm/driver_session is down
  ```

  Point an external uptime monitor (e.g. UptimeRobot, free tier) at this
  URL — it's the only alerting the stack has.

- **Driver session exchange:** a garbage token proves the route reaches the
  service and that Bubble Box verification is enforced. Check liveness and
  browser preflight first:

  ```bash
  curl -s -w ' HTTP:%{http_code}\n' https://fleet.ysz.life/api/driver-session
  # expect: {"ok":true} HTTP:200
  ```

  Exercise an actual browser preflight from PowerShell. A status-only
  `OPTIONS` is insufficient: the request must carry the browser headers, and
  the response must allow this origin, method, and header.

  ```powershell
  $preflightLines = curl.exe -sS -D - -o NUL -X OPTIONS `
    -H 'Origin: https://rider-proof.invalid' `
    -H 'Access-Control-Request-Method: POST' `
    -H 'Access-Control-Request-Headers: content-type' `
    https://fleet.ysz.life/api/driver-session
  if ($LASTEXITCODE -ne 0) { throw 'driver-session preflight request failed' }

  $preflight = $preflightLines -join "`n"
  $required = @(
    '(?im)^HTTP/\S+\s+204(?:\s|$)',
    '(?im)^Access-Control-Allow-Origin:\s*\*\s*$',
    '(?im)^Access-Control-Allow-Methods:.*\bPOST\b',
    '(?im)^Access-Control-Allow-Headers:.*\bContent-Type\b'
  )
  foreach ($pattern in $required) {
    if ($preflight -notmatch $pattern) {
      throw "driver-session preflight failed assertion: $pattern"
    }
  }
  'PASS preflight: 204, origin *, method POST, header Content-Type'
  ```

  Then confirm an invalid token reaches verification:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://fleet.ysz.life/api/driver-session \
    -H 'Content-Type: application/json' -d '{"token":"not-a-jwt"}'
  # expect: 401  (404 means Caddy never got the route — the box's git is behind)
  ```

The checks above confirm liveness, CORS, and rejection behavior. They do not
prove a real rider exchange or authenticated GPS write.

### Human-gated real-token proof and cleanup

This controlled proof mutates production: it creates one temporary vehicle,
may auto-provision one Auth user, writes one GPS point, then removes all three.
It requires no migration. Use a rider you control who will stay logged out
except for this proof.

Keep one VPS shell open from preflight through cleanup. The read-only preflight
must show that both the rider mapping and deterministic Auth email are absent;
that before-state is what distinguishes proof-created state from pre-existing
state. If either exists, or if the shell/before-state is lost, **stop**. Never
repurpose or delete the existing state.

#### 1. Preflight and temporary mapping (VPS)

Set the approved numeric rider id. The script generates all cleanup keys,
requires typed approval, pauses route sync, and inserts one offline vehicle.

```bash
set -euo pipefail
cd /opt/fleetmap
app() { docker compose -f docker-compose.prod.yml "$@"; }
db() { docker compose -f supabase-docker/docker-compose.yml "$@"; }

PROOF_RIDER_REF='<approved numeric production rider id>'
case "$PROOF_RIDER_REF" in
  ''|*[!0-9]*) echo 'STOP: rider id must be numeric' >&2; exit 2 ;;
esac
PROOF_VEHICLE_ID="$(tr -d '\r\n' < /proc/sys/kernel/random/uuid)"
PROOF_LABEL="driver-session-proof-${PROOF_VEHICLE_ID}"
PROOF_USER_EMAIL="rider-${PROOF_RIDER_REF}@driver.fleetmap.internal"

db exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v rider_ref="$PROOF_RIDER_REF" -v vehicle_id="$PROOF_VEHICLE_ID" \
  -v proof_label="$PROOF_LABEL" -v proof_email="$PROOF_USER_EMAIL" <<'SQL'
\set QUIET 1
select exists (
  select 1 from public.vehicles where rider_ref = :'rider_ref'
) as mapping_exists \gset
select exists (
  select 1 from auth.users where email = :'proof_email'
) as user_exists \gset
select exists (
  select 1 from public.vehicles
  where id = :'vehicle_id'::uuid or label = :'proof_label'
) as vehicle_collision \gset
\set QUIET 0
\if :mapping_exists
  do $$ begin raise exception 'STOP: rider mapping is pre-existing'; end $$;
\endif
\if :user_exists
  do $$ begin raise exception 'STOP: deterministic Auth user is pre-existing'; end $$;
\endif
\if :vehicle_collision
  do $$ begin raise exception 'STOP: generated vehicle key collided; rerun preflight'; end $$;
\endif
select :'rider_ref' as rider_ref, :'vehicle_id' as proof_vehicle_id,
       :'proof_label' as proof_label, :'proof_email' as proof_email;
SQL

printf 'Type the proof vehicle UUID to approve this production mutation: '
read -r APPROVED_ID
[ "$APPROVED_ID" = "$PROOF_VEHICLE_ID" ] || {
  echo 'STOP: approval did not match' >&2
  exit 23
}

SYNC_WAS_RUNNING=0
if [ -n "$(app ps --status running -q sync)" ]; then
  SYNC_WAS_RUNNING=1
  app stop sync
fi
CLEANUP_COMPLETE=0
finish_proof() {
  if [ "${SYNC_WAS_RUNNING:-0}" = 1 ]; then
    if [ "${CLEANUP_COMPLETE:-0}" = 1 ]; then
      app up -d --no-build sync
    else
      echo 'STOP: cleanup incomplete; sync remains stopped' >&2
    fi
  fi
}
trap finish_proof EXIT

db exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v rider_ref="$PROOF_RIDER_REF" -v vehicle_id="$PROOF_VEHICLE_ID" \
  -v proof_label="$PROOF_LABEL" <<'SQL'
insert into public.vehicles (id, label, status, rider_ref)
values (:'vehicle_id'::uuid, :'proof_label', 'offline', :'rider_ref');
SQL
printf 'Proof rider: %s\nProof email: %s\n' \
  "$PROOF_RIDER_REF" "$PROOF_USER_EMAIL"
```

Pausing `sync` prevents a route tick from attaching real stops. Leave this
shell open. Its exit trap restarts sync only after guarded cleanup succeeds.

#### 2. Exchange, forced refresh, and authenticated GPS write (local PowerShell)

Run this from the local repo with its production public Supabase values and
Bubble Box fleet credentials in `.env`. Enter the exact rider id printed above
and paste that rider's fresh `fleetAuthToken` only at the masked prompt (for
the staging test rider, `pnpm --silent mint-fleet-auth-token` prints one). The
token goes to the helper on stdin. The exchanged and refreshed Supabase tokens
remain in that process's memory; they never enter argv, a file, logs, or
output.

The focused helper preserves the proof guard and exercises the complete client
lifecycle. It verifies the `fleetAuthToken` directly with Bubble Box and
requires the approved rider id, exchanges it for a session, calls Supabase
`setSession`, explicitly calls `refreshSession`, validates the refreshed user
with `getUser`, and sends the GPS request with the refreshed access token.

```powershell
$ErrorActionPreference = 'Stop'

$proofRider = Read-Host 'Exact proof rider id printed by VPS'
if ($proofRider -notmatch '^\d+$') { throw 'proof rider id must be numeric' }

$latText = Read-Host 'Approved proof latitude (decimal point)'
$lngText = Read-Host 'Approved proof longitude (decimal point)'
$lat = 0.0
$lng = 0.0
$culture = [Globalization.CultureInfo]::InvariantCulture
$style = [Globalization.NumberStyles]::Float
if (-not [double]::TryParse($latText, $style, $culture, [ref]$lat) -or
    $lat -lt -90 -or $lat -gt 90) { throw 'invalid latitude' }
if (-not [double]::TryParse($lngText, $style, $culture, [ref]$lng) -or
    $lng -lt -180 -or $lng -gt 180) { throw 'invalid longitude' }
$latArg = $lat.ToString('R', $culture)
$lngArg = $lng.ToString('R', $culture)

$secureToken = Read-Host 'Paste fresh fleetAuthToken' -AsSecureString
$tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $fleetToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
}
if ([string]::IsNullOrWhiteSpace($fleetToken)) { throw 'token is empty' }

$env:DRIVER_SESSION_PROOF_URL =
  'https://fleet.ysz.life/api/driver-session'
$env:DRIVER_SESSION_LOCATION_URL =
  'https://fleet.ysz.life/api/location'
try {
  $proofOutput = $fleetToken |
    pnpm --silent prove-driver-session $proofRider $latArg $lngArg 2>&1
  $proofExit = $LASTEXITCODE
  $proofText = $proofOutput -join "`n"
  if ($proofExit -ne 0 -or
      $proofText -notmatch
        '(?m)^PASS: refreshed session and authenticated GPS write$' -or
      $proofText -notmatch '(?m)^recorded_at: \d{4}-\d{2}-\d{2}T') {
    throw 'STOP: driver-session production proof failed'
  }
  $proofOutput
} finally {
  Remove-Item Env:DRIVER_SESSION_PROOF_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DRIVER_SESSION_LOCATION_URL -ErrorAction SilentlyContinue
  $proofOutput = $proofText = $fleetToken = $secureToken = $null
}
```

Only the fixed pass line and `recorded_at` timestamp should print. If any step
fails, do not claim the proof passed, but still run cleanup.

#### 3. Guarded cleanup (same VPS shell)

The cleanup accepts no operator-supplied user id. It derives the possible
proof-created user from the deterministic email that preflight proved absent,
then atomically checks exact vehicle provenance, assignment, other assignments,
and route stops before deleting anything. If it raises, **stop and inspect;
never broaden the predicates**.

```bash
db exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -v rider_ref="$PROOF_RIDER_REF" -v vehicle_id="$PROOF_VEHICLE_ID" \
  -v proof_label="$PROOF_LABEL" -v proof_email="$PROOF_USER_EMAIL" <<'SQL'
select set_config('fleetmap.proof_rider_ref', :'rider_ref', false);
select set_config('fleetmap.proof_vehicle_id', :'vehicle_id', false);
select set_config('fleetmap.proof_label', :'proof_label', false);
select set_config('fleetmap.proof_email', :'proof_email', false);

do $cleanup$
declare
  proof_user_id uuid;
  vehicle_user_id uuid;
begin
  select assigned_user_id into vehicle_user_id
  from public.vehicles
  where id = current_setting('fleetmap.proof_vehicle_id')::uuid
    and label = current_setting('fleetmap.proof_label')
    and rider_ref = current_setting('fleetmap.proof_rider_ref')
  for update;
  if not found then
    raise exception 'STOP: exact proof vehicle check failed';
  end if;

  if (
    select count(*) from auth.users
    where email = current_setting('fleetmap.proof_email')
  ) > 1 then
    raise exception 'STOP: proof email is not unique';
  end if;
  select id into proof_user_id from auth.users
  where email = current_setting('fleetmap.proof_email');

  if vehicle_user_id is not null
     and (proof_user_id is null or vehicle_user_id <> proof_user_id) then
    raise exception 'STOP: vehicle assignment is not the proof user';
  end if;
  if proof_user_id is not null and exists (
    select 1 from public.vehicles
    where assigned_user_id = proof_user_id
      and id <> current_setting('fleetmap.proof_vehicle_id')::uuid
  ) then
    raise exception 'STOP: proof user is assigned elsewhere';
  end if;
  if exists (
    select 1 from public.stops
    where vehicle_id = current_setting('fleetmap.proof_vehicle_id')::uuid
  ) then
    raise exception 'STOP: route stops reference proof vehicle';
  end if;

  delete from public.vehicles
  where id = current_setting('fleetmap.proof_vehicle_id')::uuid
    and label = current_setting('fleetmap.proof_label')
    and rider_ref = current_setting('fleetmap.proof_rider_ref');
  if not found then raise exception 'STOP: vehicle delete predicate changed'; end if;

  if proof_user_id is not null then
    delete from auth.users
    where id = proof_user_id
      and email = current_setting('fleetmap.proof_email');
    if not found then raise exception 'STOP: user delete predicate changed'; end if;
  end if;
end
$cleanup$;

\set QUIET 1
select not exists (
  select 1 from public.vehicles where id = :'vehicle_id'::uuid
) as vehicle_removed \gset
select not exists (
  select 1 from public.vehicle_positions where vehicle_id = :'vehicle_id'::uuid
) as positions_removed \gset
select not exists (
  select 1 from auth.users where email = :'proof_email'
) as user_removed \gset
\set QUIET 0
\if :vehicle_removed
\else
  do $$ begin raise exception 'STOP: proof vehicle remains'; end $$;
\endif
\if :positions_removed
\else
  do $$ begin raise exception 'STOP: proof positions remain'; end $$;
\endif
\if :user_removed
\else
  do $$ begin raise exception 'STOP: proof user remains'; end $$;
\endif
\echo 'PASS cleanup: vehicle, positions, and proof-created Auth user removed'
SQL

CLEANUP_COMPLETE=1
finish_proof
SYNC_WAS_RUNNING=0
trap - EXIT
```

The vehicle delete cascades only to its `vehicle_positions`. The Auth user
delete is allowed only because the same-shell preflight proved the exact email
was absent; Auth-internal dependent rows cascade from that user. A rejected
guard or foreign key rolls back the entire `DO`, and sync remains stopped.

---

## 10. Hand the URL to the driver app

Send Roman **`docs/driver-session-api.md`** — it is the whole handoff in one
file: the three app constants (`API_BASE_URL` unchanged, the new Supabase URL
+ publishable key) plus the `POST /api/driver-session` exchange that removes
the drivers' second login. One release covers both.

That supersedes the older "just re-point the two constants" instruction: with
the exchange, driver passwords stop existing (new riders auto-provision on
first login), so there is nothing left to migrate per driver.

> **Timing:** the verification cutover in commit `530b117` is live and was
> healthy on 2026-08-10; on 2026-08-11 the Bubble Box verification chain was
> proven end to end from outside with a self-served staging token
> (`pnpm mint-fleet-auth-token`), so the controlled production proof (§9) can
> run at any time. The request-lifecycle diagnostic image is not deployed;
> deploy it, run the §9 proof, then perform the controlled TestFlight retry
> once a client build with the new flow exists.

> Note: since the exchange, real riders auto-provision their own identities
> and map to vehicles by `rider_ref`, so fake-GPS vans (which have no
> `rider_ref`) no longer fight a real driver over one marker — they just
> render as extra vans beside the real ones.

---

## Backups

Self-hosting means we own durability. A nightly `pg_dump` runs off
`supabase-docker/backup.sh`:

```sh
#!/bin/sh
set -eu
mkdir -p /opt/fleetmap-backups
docker compose -f /opt/fleetmap/supabase-docker/docker-compose.yml exec -T db pg_dump -U postgres postgres | gzip > "/opt/fleetmap-backups/fleetmap-$(date +%F).sql.gz"
find /opt/fleetmap-backups -name 'fleetmap-*.sql.gz' -mtime +14 -delete
```

Dumps go to `/opt/fleetmap-backups/` (outside both compose projects), 14-day
rotation. Install the cron job:

```bash
chmod +x /opt/fleetmap/supabase-docker/backup.sh
crontab -e
# add:
10 2 * * * /opt/fleetmap/supabase-docker/backup.sh
```

Offsite copies aren't set up yet — can come later on the company box.

---

## Rollback

### Image rollback for this cutover

Immediately before loading a new archive, preserve the currently running tags
outside the deployment directory:

```bash
set -euo pipefail
install -d -m 700 /opt/fleetmap-rollbacks
docker save fleetmap-app:latest fleetmap-sync:latest \
  fleetmap-driver-session:latest \
  | gzip > /opt/fleetmap-rollbacks/fleetmap-images-before-cutover.tar.gz
test -s /opt/fleetmap-rollbacks/fleetmap-images-before-cutover.tar.gz
```

If startup or health fails after the load, restore those tags and recreate
only their consumers without building:

```bash
set -euo pipefail
cd /opt/fleetmap
docker load \
  < /opt/fleetmap-rollbacks/fleetmap-images-before-cutover.tar.gz
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate \
  app sync driver-session
docker compose -f docker-compose.prod.yml ps app sync driver-session
docker compose -f docker-compose.prod.yml logs --tail=50 \
  app sync driver-session
curl -fsS https://fleet.ysz.life/api/health
```

Keep the archive until the cutover and controlled proof have both passed.

### Supabase-project rollback

The managed cloud Supabase project is kept alive, untouched, as the
rollback path until it's formally retired. To roll back:

1. Edit `/opt/fleetmap/.env`: flip `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` back to the cloud project's values
   (parked in `.env.cloud` on the dev machine).
2. Rebuild the app image with those same values as build args (§7) — they're
   baked in at build time, so a `.env` edit alone doesn't do it.
3. Ship + `./redeploy.sh` (§8).

The self-hosted stack can keep running underneath; nothing needs to be torn
down for a rollback.

---

## Operations

| Task | Command (from `/opt/fleetmap`) |
|---|---|
| Deploy app-code changes | Build + ship locally (§7), then `./redeploy.sh` on the VPS |
| Deploy docs/compose-only changes | `./redeploy.sh` on the VPS (git pull is enough — nothing to load) |
| App logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Sync worker logs | `docker compose -f docker-compose.prod.yml logs -f sync` |
| Driver-session logs | `docker compose -f docker-compose.prod.yml logs -f --since=5s driver-session` |
| Rotate Bubble Box credentials | update `/opt/fleetmap/.env` and `/opt/fleetmap/.env.driver-session`; run `docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate sync driver-session`; then check `ps`, `logs --tail=50 sync driver-session`, and `/api/health` |
| Supabase logs | `docker compose -f supabase-docker/docker-compose.yml logs -f <service>` |
| Restart app only | `docker compose -f docker-compose.prod.yml restart app` |
| Stop app stack | `docker compose -f docker-compose.prod.yml down` |
| Stop Supabase stack | `docker compose -f supabase-docker/docker-compose.yml down` |
| Status (app stack) | `docker compose -f docker-compose.prod.yml ps` |
| Status (Supabase stack) | `docker compose -f supabase-docker/docker-compose.yml ps` |
| Migrations against prod | SSH tunnel + `pnpm supabase db push --db-url ...` — see §5 |
| Manual backup | `/opt/fleetmap/supabase-docker/backup.sh` |

Everything has `restart: unless-stopped`, so both stacks come back on their
own after a reboot. OSRM data, Caddy's certs, and the Supabase db volume
persist across redeploys and reboots — nothing gets re-fetched, re-issued,
or re-migrated on its own.

### Driver-session one-login diagnostics

During a controlled login test, follow the worker with
`docker compose -f docker-compose.prod.yml logs -f --since=5s driver-session`.
`request_received` proves that the exact worker route was reached;
`request_completed` records its status. `OPTIONS` without a following `POST`
means the browser stopped after preflight. A `POST` ending in `400` means the
public JSON contract was malformed. `token_rejected`, `unmapped_rider`, and
`session_minted` remain the verification, mapping, and success outcomes.

No event means the exact worker route was not reached; it must not be
interpreted as Bubble Box rejecting a token.

The strict field allowlist applies specifically to the new `request_received`,
`request_completed`, and `request_aborted` lifecycle events. Existing exchange
outcome events retain their operational rider and reason fields, so
`unmapped_rider` remains actionable. They still never log a token, request
body, or credentials.

---

## Post-cutover manual checklist

The orders and login tracks are independent. Bubble Box production fleet API
go-live does not need to wait for the rider-session release.

- Put the production `BB_API_URL`, `BB_API_USERNAME`, and `BB_API_PASSWORD` in
  both `/opt/fleetmap/.env` for `sync` and
  `/opt/fleetmap/.env.driver-session` for rider-token verification.
  Force-recreate both services with `--no-build --force-recreate`, then
  verify their status, recent logs, and `/api/health` as described in §6.
- Read rider ids from the production feed itself. Create one controlled
  `vehicles` row per production rider and set `rider_ref` to that environment's
  rider id; staging ids must not be copied into production. Investigate any two
  rider ids that appear to represent one physical van before mapping them.
- Run the complete human-gated proof in §9. Its preflight must prove the rider
  mapping and deterministic Auth email are absent; its in-memory exchange must
  verify authenticated `POST /api/location`; and its guarded cleanup must
  remove the exact proof vehicle, positions, and proof-created Auth user before
  `sync` resumes.
- After the first proven live day, retire the old managed-cloud Supabase
  project once its rollback value is no longer needed.
- Separately, for the old **local demo** `Test Van` only, first select
  `id, rider_ref, assigned_user_id` and stop if `assigned_user_id` is non-null.
  Clearing that local rider mapping and running `pnpm seed-stops` is demo
  restoration, not a substitute for the production proof cleanup in §9.
- The old one-off `purge-prod-demo.ps1` and `probe-prod-driver.ps1` proof
  scripts are already absent from this repository. Keep credentials and token
  fixtures out of replacement scripts.
