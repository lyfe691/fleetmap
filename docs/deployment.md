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

> **Ordering matters on the next deploy.** Since 2026-07-29 the exchange
> verifies tokens by calling Bubble Box's `/fleet/verify-rider-token` instead
> of checking an RS256 signature locally, so `BB_DRIVER_JWT_PUBLIC_KEY_B64` is
> gone and the three `BB_API_*` vars replace it. **Write this file before
> loading the new image.** The old key left in place is harmless, but with no
> `BB_API_*` the container throws `Missing env` at boot and crash-loops — and
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

Rotating the key later (e.g. when Dmytro's real key replaces a stand-in) is an
edit plus
`docker compose -f docker-compose.prod.yml up -d driver-session` — no rebuild,
the key is runtime env, not a build arg.

---

## 7. Build & ship the app images (dev machine)

Images are built **locally**, never on the VPS (see "The one rule that
matters" above):

```bash
docker build --platform linux/amd64 -t fleetmap-app --target runner \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://sb.fleet.ysz.life \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY> .
docker build --platform linux/amd64 -t fleetmap-sync --target sync .
docker build --platform linux/amd64 -t fleetmap-driver-session --target driver-session .
docker save fleetmap-app fleetmap-sync fleetmap-driver-session | gzip > fleetmap-images.tar.gz
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

- **Health:** one endpoint covers app + Supabase + OSRM + sync freshness:

  ```bash
  curl -s https://fleet.ysz.life/api/health
  # {"ok":true,"supabase":"ok","osrm":"ok","sync":null}
  # sync is null until the Bubble Box worker has run; 503 when supabase/osrm is down
  ```

  Point an external uptime monitor (e.g. UptimeRobot, free tier) at this
  URL — it's the only alerting the stack has.

- **Driver session exchange:** a garbage token proves the route reaches the
  service and that verification is enforced:

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://fleet.ysz.life/api/driver-session \
    -H 'Content-Type: application/json' -d '{"token":"not-a-jwt"}'
  # expect: 401  (404 means Caddy never got the route — the box's git is behind)
  ```

That's the full chain confirmed: TLS → app → self-hosted Supabase → routing.

---

## 10. Hand the URL to the driver app

Send Roman **`docs/driver-session-api.md`** — it is the whole handoff in one
file: the three app constants (`API_BASE_URL` unchanged, the new Supabase URL
+ publishable key) plus the `POST /api/driver-session` exchange that removes
the drivers' second login. One release covers both.

That supersedes the older "just re-point the two constants" instruction: with
the exchange, driver passwords stop existing (new riders auto-provision on
first login), so there is nothing left to migrate per driver.

> **Timing:** his release only works once the `driver-session` service is
> deployed **and** carries Dmytro's real signing key. Shipping the app against
> a stand-in key would 401 every driver — strictly worse than two logins. Tell
> him when the endpoint is live.

> Note: `driver-<city>` test accounts are also driven by the fake-GPS
> simulator. If you run `pnpm fake-gps` locally while Roman tests the same
> city, two vans fight over one marker. Give him a city you're not
> simulating, or stop the simulator during his test.

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
| Driver-session logs | `docker compose -f docker-compose.prod.yml logs -f driver-session` |
| Swap the BB signing key | edit `.env.driver-session`, then `docker compose -f docker-compose.prod.yml up -d driver-session` |
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
