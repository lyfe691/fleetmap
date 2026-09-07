# Fleetmap — Deployment

Fleetmap runs on one Docker host per environment (Ubuntu 24.04,
`/opt/fleetmap`). 4GB RAM is the proven minimum and it is tight (the VPS keeps
~1 GB in swap); give a new host 8GB so builds are not the only thing it can
never do. Today the VPS behind `fleet.ysz.life` is the staging environment
(Bubble Box staging API); production is a fresh install of §0–§9 on the
company's instance with its own hostnames and secrets. §11 is the runbook for
moving an existing environment between hosts, kept for when that is wanted.
Every hostname below is a placeholder for the values in `/opt/fleetmap/.env`
(`FLEET_HOST`, `SUPABASE_HOST`).

## What gets deployed

Two independent Docker Compose stacks share the box: the **app stack** and the
**Supabase stack**, fronted by one Caddy.

```
phone / browser ──HTTPS──> Caddy (:443) ──> Next app (:3000) ──> Supabase (self-hosted, same box)
                              │                    └──> OSRM (:5000, internal)
                              └──> Kong (:8000, internal) ──> auth / rest / realtime / meta / studio
```

- **Caddy** — reverse proxy, free Let's Encrypt certs for both hostnames. One
  container, joined to both stacks' networks. Site addresses come from
  `FLEET_HOST` / `SUPABASE_HOST` in `.env` (plus optional `*_ALIASES`, §11).
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

Once it's up, the driver app's `API_BASE_URL` is `https://<FLEET_HOST>` and its
Supabase URL is `https://<SUPABASE_HOST>`.

---

## The one rule that matters: never build on the box

The VPS has 4GB of RAM. Building the Next image while both stacks are
running has already taken prod down once (load average 91 during a `docker
build`, the app stack starved of memory and stopped answering). **Never run
`docker compose ... up -d --build` on the server.**

Instead: build the app images on your dev machine, ship them as a tar,
`docker load` on the server, `up -d --no-build`. `redeploy.sh` does the load +
up half automatically. This applies to any change that touches app code
(`app/`, `components/`, `lib/`, `workers/`, `Dockerfile`, `package.json`,
etc). Docs-only or compose-only changes (this file, `docker-compose.prod.yml`,
`caddy/Caddyfile`) don't need an image rebuild — `./redeploy.sh` alone is
enough.

---

## 0. Prerequisites on the server

Docker + compose installed. Confirm, add git:

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

**DNS.** Two `A` records, both pointed at the server's public IP, before first
start:

| Host | Points to |
|---|---|
| `<FLEET_HOST>` | server IP |
| `<SUPABASE_HOST>` | server IP |

Confirm both resolve before bringing Caddy up:

```bash
dig +short <FLEET_HOST>
dig +short <SUPABASE_HOST>
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

Build it once; the data persists in `./osrm` across deploys and reboots. If
another Fleetmap host already has the dataset, copying its `osrm/` directory
(~1.7GB, §11) is faster than rebuilding.

---

## 3. Create the shared edge network (one-time)

Both compose stacks reference this network as `external`; create it before
starting either:

```bash
docker network create fleetmap-edge
```

---

## 4. Bring up the Supabase stack

**Generate secrets** (on your dev machine, not the server):

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

> Moving an existing deployment to a new host? Reuse the old host's
> `supabase-docker/.env` instead of generating new secrets (§11). The anon key
> is baked into the driver app and the TV; a new `JWT_SECRET` would invalidate
> both.

**Fill the env on the server:**

```bash
cd /opt/fleetmap/supabase-docker
cp .env.example .env
nano .env   # paste the generated values from above
```

Set `SITE_URL` to `https://<FLEET_HOST>` and both `API_EXTERNAL_URL` and
`SUPABASE_PUBLIC_URL` to `https://<SUPABASE_HOST>`. This file never gets
committed.

**Start it:**

```bash
docker compose up -d
docker compose ps   # wait for all healthy — studio can take ~30s
```

**Wire Caddy to it** — the `.env` in `/opt/fleetmap` (§6) must already carry
`FLEET_HOST` and `SUPABASE_HOST`, then:

```bash
cd /opt/fleetmap && docker compose -f docker-compose.prod.yml up -d caddy
ANON=$(grep ^ANON_KEY= supabase-docker/.env | cut -d= -f2)
curl -s -H "apikey: $ANON" https://<SUPABASE_HOST>/auth/v1/health
```

Expect a GoTrue version/name JSON blob over valid TLS. (A curl without the
`apikey` header returns Kong's "No API key found" — that still proves
DNS → TLS → Kong, just not GoTrue behind it.)

---

## 5. Apply migrations

Schema lives in the repo (`supabase/migrations/`), never as a dump. Run from
your dev machine through an SSH tunnel — the server's db is bound to
`127.0.0.1`, not public:

```bash
ssh -N -L 6544:127.0.0.1:5432 root@<FLEET_HOST>   # leave running in one terminal
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

Data (auth users + the public tables) is restored separately — §11 has the
dump/restore recipe.

---

## 6. Create the app `.env` on the server

```bash
cd /opt/fleetmap
cp .env.example .env
nano .env
chmod 600 .env
```

| Var | Value |
|---|---|
| `FLEET_HOST` / `SUPABASE_HOST` | the two public hostnames (Caddy site addresses; `redeploy.sh` refuses to run without them) |
| `FLEET_HOST_ALIASES` / `SUPABASE_HOST_ALIASES` | empty, except during a host move (§11) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<SUPABASE_HOST>` |
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

> **Standing requirements.** The exchange verifies tokens by calling Bubble
> Box's `/api/v2/fleet/verify-rider-token`, so all four variables must be set
> before starting or recreating `driver-session`; with them missing the
> container throws `Missing env` and crash-loops. And the file itself must
> exist before any `docker compose up` — `env_file` is mandatory: a missing
> file aborts the **entire** stack, not just that one service. Check it
> started: `docker compose -f docker-compose.prod.yml logs --tail=20 driver-session`.
>
> The `BB_API_*` values may point at staging while Bubble Box's production
> fleet API is not live. Riders can then only log in if their token was issued
> by the same environment this verifies against.

### Rotating the Bubble Box credentials

Update `BB_API_URL`, `BB_API_USERNAME`, `BB_API_PASSWORD` in both
`/opt/fleetmap/.env` (used by `sync`) and `/opt/fleetmap/.env.driver-session`
(used by `driver-session`), then force-recreate both consumers from the
already-loaded images and check them:

```bash
set -euo pipefail
cd /opt/fleetmap
chmod 600 .env .env.driver-session
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate sync driver-session
docker compose -f docker-compose.prod.yml ps sync driver-session
docker compose -f docker-compose.prod.yml logs --tail=50 sync driver-session
for service in sync driver-session; do
  test -n "$(docker compose -f docker-compose.prod.yml ps --status running -q "$service")" \
    || { echo "STOP: $service is not running" >&2; exit 1; }
done
curl -fsS "https://$(grep ^FLEET_HOST= .env | cut -d= -f2)/api/health" | grep -q '"driver_session":"ok"' \
  || { echo 'STOP: driver_session health is not ok' >&2; exit 1; }
```

Wait for a post-recreate `sync` log with `"event":"tick"` (`"tick_failed"` is
a failure). Driver-session health is liveness only, so validate rotated
credentials with the controlled token proof in §9.

---

## 7. Build & ship the app images (dev machine)

Images are built **locally**, never on the server. Build all three for every
application-code deploy:

```bash
docker build --platform linux/amd64 -t fleetmap-app:latest --target runner \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<SUPABASE_HOST> \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> .
docker build --platform linux/amd64 -t fleetmap-sync:latest --target sync .
docker build --platform linux/amd64 -t fleetmap-driver-session:latest --target driver-session .
docker save fleetmap-app:latest fleetmap-sync:latest fleetmap-driver-session:latest | gzip > fleetmap-images.tar.gz

# Inspect before upload: all three tags must be present and linux/amd64.
tar -xOzf fleetmap-images.tar.gz index.json
docker image inspect fleetmap-app:latest fleetmap-sync:latest \
  fleetmap-driver-session:latest \
  --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}} {{.Id}}'

scp fleetmap-images.tar.gz root@<FLEET_HOST>:/opt/fleetmap/
```

All three tags must be in the tar. `redeploy.sh` runs `up -d --no-build`, so a
service whose image is missing fails the whole `up` rather than silently
building.

The two workers are esbuild-bundled to a single `.mjs` and run on a bare
`node:22-bookworm-slim` as the non-root `node` user — no pnpm, no
`node_modules`, no TypeScript at runtime. That keeps them at ~327MB and the
whole tar under 100MB.

`--platform linux/amd64` matters if you're building on Apple Silicon or
another non-x86 dev machine — the server is x86_64.

---

## 8. Deploy

```bash
ssh root@<FLEET_HOST>
cd /opt/fleetmap
./redeploy.sh
```

`redeploy.sh` checks `.env` carries the hostnames, git-pulls, loads
`fleetmap-images.tar.gz` if present (then deletes it), runs `up -d --no-build`,
and reloads Caddy (its config is bind-mounted, so `up` alone would leave it on
the old routes). It never invokes `docker build`. Watch it come up:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy   # first run: watch the cert get issued
curl -I https://<FLEET_HOST>
```

A `200`/`307` over a valid TLS cert means the edge + app are live.

---

## 9. Smoke-test the pipe

Set `FLEET_HOST`/`SUPABASE_HOST` in your shell first (or read them from
`/opt/fleetmap/.env`).

- **Dashboard:** open `https://$FLEET_HOST/dashboard`, enter the display
  code → the console loads.
- **Ingest endpoint:** an unauthenticated POST is rejected with `401`:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://$FLEET_HOST/api/location" \
    -H 'Content-Type: application/json' -d '{"lat":47.37,"lng":8.54,"recorded_at":"2026-06-25T00:00:00Z"}'
  # expect: 401
  ```

- **Routing:** OSRM stays internal; confirm from inside the app container:

  ```bash
  docker compose -f docker-compose.prod.yml exec app \
    node -e "fetch('http://osrm:5000/route/v1/driving/8.5,47.3;8.55,47.35').then(r=>console.log('osrm',r.status))"
  # expect: osrm 200
  ```

- **Supabase edge:** Kong gates `/auth/v1` and `/rest/v1` behind the `apikey`
  header:

  ```bash
  curl -s -H "apikey: <ANON_KEY>" "https://$SUPABASE_HOST/auth/v1/health"
  curl -s -H "apikey: <ANON_KEY>" "https://$SUPABASE_HOST/rest/v1/"
  # both: 200 + JSON
  ```

- **Studio:** `https://$SUPABASE_HOST/` is fronted by Kong; Studio sits behind
  Kong's basic-auth (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` from
  `supabase-docker/.env`).

- **Health:** one endpoint covers app + Supabase + OSRM + driver-session
  liveness + sync freshness:

  ```bash
  curl -s "https://$FLEET_HOST/api/health"
  # {"ok":true,"supabase":"ok","osrm":"ok","driver_session":"ok","sync":{...}}
  # sync is null until the Bubble Box worker has run; 503 when supabase/osrm/driver_session is down
  ```

  Point an external uptime monitor (e.g. UptimeRobot, free tier) at this
  URL — it's the only alerting the stack has.

- **Driver session exchange:** liveness, browser preflight, and rejection:

  ```bash
  curl -s -w ' HTTP:%{http_code}\n' "https://$FLEET_HOST/api/driver-session"
  # expect: {"ok":true} HTTP:200

  curl -sS -D - -o /dev/null -X OPTIONS \
    -H 'Origin: https://rider-proof.invalid' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' \
    "https://$FLEET_HOST/api/driver-session"
  # expect: 204 with Access-Control-Allow-Origin: *, -Methods incl. POST, -Headers incl. Content-Type

  curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://$FLEET_HOST/api/driver-session" \
    -H 'Content-Type: application/json' -d '{"token":"not-a-jwt"}'
  # expect: 401  (404 means Caddy never got the route — the box's git is behind)
  ```

The checks above confirm liveness, CORS, and rejection behavior. They do not
prove a real rider exchange or authenticated GPS write — that is the proof
below, run once at go-live and after any Bubble Box credential rotation.

### Human-gated real-token proof and cleanup

This controlled proof mutates production: it creates one temporary vehicle,
may auto-provision one Auth user, writes one GPS point, then removes all three.
Use a rider you control who will stay logged out except for this proof. It
passed on 2026-08-13 against the staging credentials; run it once more with
the production credentials at go-live.

Keep one server shell open from preflight through cleanup. The read-only
preflight must show that both the rider mapping and deterministic Auth email
are absent; that before-state is what distinguishes proof-created state from
pre-existing state. If either exists, or if the shell/before-state is lost,
**stop**. Never repurpose or delete the existing state.

#### 1. Preflight and temporary mapping (server)

Set the approved numeric rider id. The script generates all cleanup keys,
requires typed approval, pauses route sync, and inserts one offline vehicle.

```bash
set -euo pipefail
cd /opt/fleetmap
app() { docker compose -f docker-compose.prod.yml "$@"; }
db() { docker compose -f supabase-docker/docker-compose.yml "$@"; }

PROOF_RIDER_REF='<approved numeric rider id>'
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

Run this from the local repo with the production public Supabase values,
`FLEETMAP_PUBLIC_URL=https://<FLEET_HOST>`, and the Bubble Box fleet
credentials in `.env`. Enter the exact rider id printed above and paste that
rider's fresh `fleetAuthToken` only at the masked prompt (for the staging test
rider, `pnpm --silent mint-fleet-auth-token` prints one). The token goes to
the helper on stdin; the exchanged and refreshed Supabase tokens stay in that
process's memory and never enter argv, a file, logs, or output.

The helper verifies the `fleetAuthToken` directly with Bubble Box and requires
the approved rider id, exchanges it for a session, calls Supabase
`setSession`, explicitly calls `refreshSession`, validates the refreshed user
with `getUser`, and sends the GPS request with the refreshed access token.

```powershell
$ErrorActionPreference = 'Stop'

$proofRider = Read-Host 'Exact proof rider id printed by the server'
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
  $proofOutput = $proofText = $fleetToken = $secureToken = $null
}
```

Only the fixed pass line and `recorded_at` timestamp should print. If any step
fails, do not claim the proof passed, but still run cleanup.

#### 3. Guarded cleanup (same server shell)

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

Send Roman `docs/driver-session-api.md` — it is the whole handoff in one file:
the three app constants (`API_BASE_URL`, the Supabase URL + publishable key)
plus the `POST /api/driver-session` exchange. Real riders auto-provision their
own identities and map to vehicles by `rider_ref`, so there is nothing to
migrate per driver; fake-GPS vans (no `rider_ref`) render beside real ones
rather than fighting over a marker.

---

## Backups

Self-hosting means we own durability. A nightly `pg_dump` runs off
`supabase-docker/backup.sh` (dumps to `/opt/fleetmap-backups/`, outside both
compose projects, 14-day rotation). Install the cron job on every host (the
VPS got it on 2026-09-07; before that only the cutover dump existed):

```bash
(crontab -l 2>/dev/null; echo '10 2 * * * sh /opt/fleetmap/supabase-docker/backup.sh') | crontab -
crontab -l
```

Offsite copies are not set up yet — a go-live item for the company box.

---

## Rollback (images)

Immediately before loading a new archive, preserve the currently running tags
outside the deployment directory:

```bash
set -euo pipefail
install -d -m 700 /opt/fleetmap-rollbacks
docker save fleetmap-app:latest fleetmap-sync:latest fleetmap-driver-session:latest \
  | gzip > /opt/fleetmap-rollbacks/fleetmap-images-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
```

If startup or health fails after the load, restore those tags and recreate
only their consumers without building:

```bash
set -euo pipefail
cd /opt/fleetmap
docker load < /opt/fleetmap-rollbacks/fleetmap-images-<timestamp>.tar.gz
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate app sync driver-session
docker compose -f docker-compose.prod.yml ps app sync driver-session
docker compose -f docker-compose.prod.yml logs --tail=50 app sync driver-session
curl -fsS "https://$(grep ^FLEET_HOST= .env | cut -d= -f2)/api/health"
```

---

## Operations

| Task | Command (from `/opt/fleetmap`) |
|---|---|
| Deploy app-code changes | Build + ship locally (§7), then `./redeploy.sh` on the server |
| Deploy docs/compose-only changes | `./redeploy.sh` on the server (git pull is enough — nothing to load) |
| App logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Sync worker logs | `docker compose -f docker-compose.prod.yml logs -f sync` |
| Driver-session logs | `docker compose -f docker-compose.prod.yml logs -f --since=5s driver-session` |
| Rotate Bubble Box credentials | §6 |
| Supabase logs | `docker compose -f supabase-docker/docker-compose.yml logs -f <service>` |
| Restart app only | `docker compose -f docker-compose.prod.yml restart app` |
| Stop app stack | `docker compose -f docker-compose.prod.yml down` |
| Stop Supabase stack | `docker compose -f supabase-docker/docker-compose.yml down` |
| Status (app stack) | `docker compose -f docker-compose.prod.yml ps` |
| Status (Supabase stack) | `docker compose -f supabase-docker/docker-compose.yml ps` |
| Migrations against prod | SSH tunnel + `pnpm supabase db push --db-url ...` — see §5 |
| Manual backup | `/opt/fleetmap/supabase-docker/backup.sh` |
| SQL on prod | `docker compose -f supabase-docker/docker-compose.yml exec -T db psql -U postgres -d postgres -c "…"` (on the server — no tunnel, no secret leaves the box) |

Everything has `restart: unless-stopped`, so both stacks come back on their
own after a reboot. OSRM data, Caddy's certs, and the Supabase db volume
persist across redeploys and reboots — nothing gets re-fetched, re-issued,
or re-migrated on its own.

### Driver-session log events

During a controlled login test, follow the worker with
`docker compose -f docker-compose.prod.yml logs -f --since=5s driver-session`.
`request_received` proves that the exact worker route was reached;
`request_completed` records its status. `OPTIONS` without a following `POST`
means the browser stopped after preflight. A `POST` ending in `400` means the
public JSON contract was malformed. `token_rejected`, `unmapped_rider`, and
`session_minted` are the verification, mapping, and success outcomes. No event
means the worker route was not reached; it must not be read as Bubble Box
rejecting a token. Events never log a token, request body, or credentials.

---

## 11. Moving to a new host

The whole deployment is two compose projects, three env files, one data
directory (`osrm/`), and one database. Everything else is rebuilt from the
repo. The move keeps every secret, so the anon key baked into the driver app
and the TV stays valid, and the old hostnames can be served as aliases from the
new box until every client has switched — the old-build rider app and the TV
keep working through the transition with zero changes on their side.

Below, `OLD` is the current host and `NEW` the target. Run each block where
its heading says. Both hosts need root SSH from the dev machine, and `NEW`
needs SSH access to `OLD` for the copies (or route them through the dev
machine).

### 1. Stage `NEW` (no downtime, any time before the cutover)

**DNS**: create the two new `A` records (§0) pointing at `NEW`. Lower the TTL
of the old records to 300 s now, so the later repoint takes effect quickly.

**On `NEW`** — prerequisites (§0), clone (§1), edge network (§3), then copy
the OSRM dataset instead of rebuilding it:

```bash
rsync -a --info=progress2 root@OLD:/opt/fleetmap/osrm/ /opt/fleetmap/osrm/
```

Copy the three env files from `OLD` and edit only the hostnames:

```bash
cd /opt/fleetmap
scp root@OLD:/opt/fleetmap/supabase-docker/.env supabase-docker/.env
scp root@OLD:/opt/fleetmap/.env .env
scp root@OLD:/opt/fleetmap/.env.driver-session .env.driver-session
chmod 600 .env .env.driver-session supabase-docker/.env
```

- `supabase-docker/.env`: `SITE_URL=https://<NEW FLEET_HOST>`,
  `API_EXTERNAL_URL` and `SUPABASE_PUBLIC_URL` = `https://<NEW SUPABASE_HOST>`,
  `SMTP_ADMIN_EMAIL` to match. **Every secret stays identical** — `JWT_SECRET`,
  `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `DASHBOARD_PASSWORD`,
  the three hex keys.
- `.env`: `FLEET_HOST`, `SUPABASE_HOST` = the new names;
  `NEXT_PUBLIC_SUPABASE_URL=https://<NEW SUPABASE_HOST>`. Leave the
  `*_ALIASES` empty for now (they come in at cutover). Everything else
  unchanged.
- `.env.driver-session`: unchanged.

Start the Supabase stack (§4 "Start it"), then apply the schema from the dev
machine through a tunnel to `NEW` (§5). Check pg_cron picked up the retention
job: `select jobname from cron.job` should list the `vehicle_positions` prune.

**On the dev machine** — build all three images with the **new**
`NEXT_PUBLIC_SUPABASE_URL` build arg (§7; the publishable key is unchanged) and
ship the tar to `NEW`. **On `NEW`**: `./redeploy.sh`, then the §9 smoke tests
against the new hostnames. The dashboard cannot log in yet (no auth rows) and
the fleet is empty — that is expected until the data restore below.

### 2. Cutover (minutes of downtime)

Tell Roman and the office first: GPS ingest and the sync pause for the length
of the copy. Driver logins survive it: the copy includes `auth.sessions` and
`auth.refresh_tokens`, so the rider app's persisted Supabase session keeps
refreshing against `NEW` (the cold-start re-mint in `docs/driver-session-api.md`
is the fallback, not the plan). The TV keeps working against the old hostnames
until it is re-pointed.

**On `OLD`** — freeze writes, dump auth users and the public tables:

```bash
set -euo pipefail
cd /opt/fleetmap
docker compose -f docker-compose.prod.yml stop sync driver-session app
db() { docker compose -f supabase-docker/docker-compose.yml "$@"; }
db exec -T db pg_dump -U postgres --data-only --column-inserts \
  -t auth.users -t auth.identities -t auth.sessions -t auth.refresh_tokens postgres > /root/auth-data.sql
db exec -T db pg_dump -U postgres --data-only \
  -t public.operational_areas -t public.vehicles -t public.orders \
  -t public.stops -t public.vehicle_positions -t public.sync_state postgres > /root/public-data.sql
ls -la /root/auth-data.sql /root/public-data.sql
```

**On `NEW`** — restore into the empty schema and fix the one sequence. (If
you rehearsed a restore during staging, empty the target first: `truncate
public.stops, public.orders, public.vehicle_positions, public.vehicles,
public.operational_areas, public.sync_state; delete from auth.refresh_tokens;
delete from auth.sessions; delete from auth.identities; delete from auth.users;`.)

```bash
set -euo pipefail
cd /opt/fleetmap
scp root@OLD:/root/auth-data.sql root@OLD:/root/public-data.sql /root/
db() { docker compose -f supabase-docker/docker-compose.yml "$@"; }
db exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "set session_replication_role = replica" -f - < /root/auth-data.sql
db exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "set session_replication_role = replica" -f - < /root/public-data.sql
db exec -T db psql -U postgres -d postgres -Atc \
  "select setval(pg_get_serial_sequence('public.vehicle_positions','id'), coalesce(max(id),1)) from public.vehicle_positions;
   select (select count(*) from auth.users) users, (select count(*) from public.vehicles) vehicles,
          (select count(*) from public.stops) stops, (select count(*) from public.vehicle_positions) positions"
shred -u /root/auth-data.sql /root/public-data.sql
ssh root@OLD 'shred -u /root/auth-data.sql /root/public-data.sql'
```

Compare the counts with `OLD` (same queries there). Then start the workers on
`NEW` and confirm the sync ticks and the dashboard logs in with the display
code:

```bash
docker compose -f docker-compose.prod.yml up -d --no-build
docker compose -f docker-compose.prod.yml logs --tail=20 sync driver-session
curl -fsS "https://<NEW FLEET_HOST>/api/health"
```

**Repoint the old names** so old app builds and the TV follow without any
change on their side:

1. DNS: change the `A` records for the old `FLEET_HOST` and `SUPABASE_HOST` to
   `NEW`'s IP.
2. On `NEW`, in `.env`: `FLEET_HOST_ALIASES=<old fleet host>` and
   `SUPABASE_HOST_ALIASES=<old supabase host>`, then `./redeploy.sh`. Caddy
   issues certificates for the aliases as soon as the DNS change has
   propagated (`logs -f caddy`).
3. `curl -fsS https://<old fleet host>/api/health` from outside — served by
   `NEW` now. Roman's existing build and the TV are live again.

**On `OLD`** — stop both stacks but keep everything on disk for the soak:

```bash
cd /opt/fleetmap
docker compose -f docker-compose.prod.yml down
docker compose -f supabase-docker/docker-compose.yml down
```

**Rollback** during the soak: repoint the old `A` records back to `OLD`, drop
the aliases from `NEW`'s `.env`, `up -d` both stacks on `OLD`. Positions
written to `NEW` in between are lost; orders re-sync from Bubble Box on the
next tick.

### 3. Finish

- Install the backup cron on `NEW` (Backups above) and point the uptime
  monitor at the new health URL.
- Send Roman the updated `docs/driver-session-api.md` with the new
  `API_BASE_URL` and Supabase URL (same publishable key); someone on-site
  opens `https://<NEW FLEET_HOST>/dashboard` on the TV and enters the display
  code.
- Once Roman's release with the new constants is out and the TV is
  re-pointed, clear both `*_ALIASES` in `.env`, `./redeploy.sh`, and let the
  old DNS records go.
- After a clean week: `docker volume rm` the Supabase volume on `OLD` (or
  wipe the box). The old nightly dumps in `/opt/fleetmap-backups` are the last
  copy of pre-move history — pull them to the new host or offsite first.

---

## Go-live checklist (production instance)

Run on the company's production host after §0–§9. The orders and login
tracks are independent, but both switch on the same credentials.

- Put the production `BB_API_URL` (`https://bubblebox.ch`, per Dmytro
  2026-09-07), `BB_API_USERNAME`, and `BB_API_PASSWORD` in both
  `/opt/fleetmap/.env` (for `sync`) and `/opt/fleetmap/.env.driver-session`
  (for rider-token verification), then run the rotation recipe in §6.
- Read rider ids from the production feed itself (`sync` logs them as
  `unmapped rider`, or query the fleet API with the production credentials).
  Create one `vehicles` row per production rider and set `rider_ref` to that
  environment's rider id. The staging test riders (ids 6 and 13) must not be
  carried into production: clear their `rider_ref` or delete their vehicles
  and auto-provisioned `rider-<id>@driver.fleetmap.internal` users.
- Rotate `DASHBOARD_DISPLAY_CODE` and `DISPATCHER_INGEST_SECRET` in `.env`
  (the TV and the sync are the only consumers; `--force-recreate app sync`).
- Delete the legacy `driver-roman@fleetmap.app` Auth user (pre-exchange test
  identity, owns no vehicle) and any other identity that is not the dashboard,
  the dispatcher, or an auto-provisioned `rider-<id>@driver.fleetmap.internal`.
- Run the human-gated proof in §9 once with a production rider you control.
- Point an uptime monitor at `/api/health`; set up an offsite copy of
  `/opt/fleetmap-backups`.
- Send Roman the three constants of the production instance (`API_BASE_URL`,
  Supabase URL, publishable key) in `docs/driver-session-api.md`; his
  production build points there. Staging test builds keep pointing at the VPS.
