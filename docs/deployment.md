# Fleetmap — VPS Deployment

Deploying fleetmap to the Hostinger VPS (`srv1711452.hstgr.cloud`, Ubuntu 24.04, Docker already installed).

## What actually gets deployed

Supabase is **managed cloud** — it's not on the VPS. So "deploy" just means running two things on the box behind HTTPS, both pointed at the same Supabase project you already use in dev:

```
phone / browser ──HTTPS──> Caddy (:443) ──> Next app (:3000) ──> Supabase (cloud)
                                                  └──> OSRM (:5000, internal)
```

- **Caddy** — reverse proxy, gets a free Let's Encrypt cert automatically for the hostname.
- **Next app** — the dashboard + API routes, built into a standalone Docker image.
- **OSRM** — routing engine, Switzerland extract, internal-only.

Three files drive it, all in the repo: `Dockerfile`, `docker-compose.prod.yml`, `caddy/Caddyfile`.

Once it's up, the driver app's `API_BASE_URL` is **`https://srv1711452.hstgr.cloud`**.

---

## 0. Reboot first (one-time)

The login banner said a kernel upgrade is pending and a restart is required. Get it out of the way:

```bash
reboot
```

Reconnect after a minute.

---

## 1. Prerequisites on the VPS

Docker + compose are already installed (you upgraded them). Confirm and add git:

```bash
docker --version && docker compose version
apt-get install -y git
```

Open the firewall for HTTP/HTTPS if `ufw` is active (Caddy needs both — 80 is used for the ACME challenge, then redirects to 443):

```bash
ufw status                      # if inactive, skip the next two lines
ufw allow 80,443/tcp
ufw reload
```

> DNS: `srv1711452.hstgr.cloud` already resolves to this VPS (it's the Hostinger-assigned hostname), so Caddy can issue a cert with no extra DNS setup. If you later put it on a custom domain, point an A record at `187.124.1.41` first.

---

## 2. Clone the repo

```bash
cd /opt
git clone https://github.com/lyfe691/fleetmap.git
cd fleetmap
```

---

## 3. Build the OSRM dataset (one-time, ~few min)

OSRM needs a pre-processed Switzerland graph before it can serve. This produces the files in `./osrm` that the container reads:

```bash
mkdir -p osrm
wget https://download.geofabrik.de/europe/switzerland-latest.osm.pbf -P ./osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409 osrm-extract   -p /opt/car.lua /data/switzerland-latest.osm.pbf
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409 osrm-partition           /data/switzerland-latest.osrm
docker run -t -v "${PWD}/osrm:/data" osrm/osrm-backend@sha256:af5d4a83fb90086a43b1ae2ca22872e6768766ad5fcbb07a29ff90ec644ee409 osrm-customize           /data/switzerland-latest.osrm
```

Build it once; the data persists in `./osrm` across deploys and reboots.

---

## 4. Create `.env` on the VPS

This file is read for both the build (the `NEXT_PUBLIC_*` values get baked into the client bundle) and the runtime (everything else). Copy the example and fill it:

```bash
cp .env.example .env
nano .env
```

Fill in:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as your dev `.env` (managed Supabase project) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same as dev |
| `NEXT_PUBLIC_MAPTILER_KEY` | your MapTiler key — **lock it to `srv1711452.hstgr.cloud` in the MapTiler dashboard** before going public |
| `SUPABASE_SECRET_KEY` | leave it out / blank — the deployed app never needs it (dev-scripts only) |
| `OSRM_URL` | ignored here — compose overrides it to `http://osrm:5000` |
| `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` / `DASHBOARD_DISPLAY_CODE` | the TV gate identity + code |
| `DISPATCHER_EMAIL` / `DISPATCHER_PASSWORD` / `DISPATCHER_INGEST_SECRET` | dispatcher identity + ingest secret |
| `GEOFENCE_ARRIVE_RADIUS_M` / `GEOFENCE_DEPART_RADIUS_M` | keep defaults (60 / 120) |

> Reusing the dev Supabase project means the `dashboard` and `dispatcher` identities are already provisioned and the schema is already migrated — nothing extra to do. If you ever spin up a separate prod Supabase project, you'd re-run the migrations and `pnpm provision-dashboard` / `pnpm provision-dispatcher` against it (from your local machine — those scripts talk to Supabase directly, not to the VPS).

---

## 5. Build & start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build pulls the Node image and compiles the app (a couple of minutes). Watch it come up:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy   # watch the cert get issued
```

Caddy logs a certificate-obtained line within a few seconds of the first request. Then:

```bash
curl -I https://srv1711452.hstgr.cloud
```

A `200`/`307` over a valid TLS cert means the edge + app are live.

---

## 6. Smoke-test the pipe

- **Dashboard:** open `https://srv1711452.hstgr.cloud/dashboard`, enter the display code → the console loads.
- **Ingest endpoint:** an unauthenticated POST should be rejected with `401` (proves the route is live and auth is enforced):

  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://srv1711452.hstgr.cloud/api/location \
    -H 'Content-Type: application/json' -d '{"lat":47.37,"lng":8.54,"recorded_at":"2026-06-25T00:00:00Z"}'
  # expect: 401
  ```

- **Routing:** OSRM stays internal, but you can confirm it from inside the app container:

  ```bash
  docker compose -f docker-compose.prod.yml exec app \
    node -e "fetch('http://osrm:5000/route/v1/driving/8.5,47.3;8.55,47.35').then(r=>console.log('osrm',r.status))"
  # expect: osrm 200
  ```

That's the full chain confirmed: TLS → app → auth → routing.

---

## 7. Hand the URL to the driver app

Now that it's live, `API_BASE_URL = https://srv1711452.hstgr.cloud`. Update §8 of `docs/driver-app-handoff.md` and send Roman:

- `API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (client-public)
- a test driver login (e.g. `driver-zurich@example.com` / `fake-gps-dev-123`)

He can now do a real end-to-end test against the deployed host — no localhost needed.

> Note: those `driver-<city>` accounts are also driven by the fake-GPS simulator. If you run `pnpm fake-gps` locally while Roman tests the same city, two vans fight over one marker. Give him a city you're not simulating, or stop the simulator during his test.

---

## Operations

| Task | Command (from `/opt/fleetmap`) |
|---|---|
| Deploy new code | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| Restart app only | `docker compose -f docker-compose.prod.yml restart app` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` |
| Status | `docker compose -f docker-compose.prod.yml ps` |

Everything has `restart: unless-stopped`, so the stack comes back on its own after a reboot. OSRM data and Caddy's certs live in volumes/`./osrm`, so redeploys don't re-fetch or re-issue them.
