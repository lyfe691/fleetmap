# fleetmap

Real-time map of a delivery fleet. Each van's phone streams GPS to the backend; an office TV shows every van moving live, with routes, ETAs, and stop status. Orders arrive automatically from the Bubble Box route optimizer — nothing is entered by hand. Same shape as Uber, minus rider matching.

## Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 16 (App Router, TypeScript) |
| Database / Realtime / Auth | Supabase (Postgres, Realtime, RLS) — local CLI stack in dev, self-hosted on the VPS in prod |
| Map | MapLibre GL via `react-map-gl`; tiles from OpenFreeMap (free, keyless) |
| Routing + ETA | OSRM, self-hosted (Docker, Switzerland extract) |
| Orders | Sync worker polling the Bubble Box fleet API (their optimizer owns assignment, ordering, and status) |
| Driver client | Bubblebox native rider app → `POST /api/location` |
| Deployment | Docker on one VPS: Caddy (TLS) → Next → OSRM + sync, beside the self-hosted Supabase stack (see [`docs/deployment.md`](docs/deployment.md)) |

## Architecture

Two data flows, one stateless API:

- **GPS (push):** phone → `POST /api/location` (authed, RLS-scoped per driver) → latest position onto the vehicle row + append to history → Supabase Realtime broadcasts the change → the dashboard moves that marker.
- **Orders (pull):** `workers/bubblebox-sync.ts` polls the Bubble Box fleet API every 60 s and mirrors each rider's routes into orders/stops via a diff-applying RPC — stop rows keep their identity across ticks, so status flips are cheap updates, not churn. The dashboard calls `GET /api/route` (→ OSRM) for route lines and ETAs.

The API stays thin (ingest + OSRM proxy). Live fan-out is Supabase Realtime's job — no Redis, no custom WebSocket server.

The dashboard is a touchscreen monitoring console: a 3-region layout (sidebar nav + fleet rail + per-vehicle tracking / live map / history replay) with light/dark theming, schedule-adherence lateness, and en/de-CH i18n.

## Setup

**Prerequisites**: Node.js, pnpm, Docker.

```bash
pnpm install
pnpm supabase start        # local Supabase stack (first run pulls images)
pnpm supabase db reset     # apply all migrations + seed
cp .env.example .env       # fill from the `supabase start` output (see below)
pnpm provision-dashboard && pnpm provision-dispatcher && pnpm provision-driver
docker compose up -d osrm  # routing engine (one-time dataset build — see docker-compose.yml)
pnpm dev
```

For moving demo data: `pnpm fake-gps` once (provisions the city vans), then `pnpm seed-stops`. For the real order pipeline against a fixture: `BB_FIXTURE_FILE=workers/dev-fixture.json pnpm bb-sync`.

### Environment variables

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Printed by `pnpm supabase start` |
| `SUPABASE_SECRET_KEY` | Same output — dev/scripts only, never ships in a deployed image |
| `OSRM_URL` | `http://localhost:5000` in dev; `http://osrm:5000` inside compose |
| `DASHBOARD_*` / `DISPATCHER_*` | Set when provisioning those identities |
| `BB_API_URL` / `BB_API_USERNAME` / `BB_API_PASSWORD` | Bubble Box fleet API + its login (or use `BB_FIXTURE_FILE` instead) |

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | tsc, ESLint, vitest unit suite |
| `pnpm bb-sync` | Bubble Box route sync worker (fixture mode via `BB_FIXTURE_FILE`) |
| `pnpm fake-gps` | Dev-only: moving fake GPS feed (dev server must be running) |
| `pnpm seed-stops` | Dev-only: seed a day of demo orders/stops |
| `pnpm provision-{dashboard,dispatcher,driver}` | Create the Auth identities |
| `pnpm supabase start` / `stop` / `db reset` | Local Supabase stack lifecycle |

## Deployment

Two compose stacks on one VPS: the app stack (`docker-compose.prod.yml` — Caddy → Next → OSRM + the sync worker) and the self-hosted Supabase stack (`supabase-docker/`). App images are **built locally and shipped as a tar** — the box never builds:

```bash
docker build --platform linux/amd64 -t fleetmap-app --target runner \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .
docker build --platform linux/amd64 -t fleetmap-sync --target sync .
docker save fleetmap-app fleetmap-sync | gzip > fleetmap-images.tar.gz
scp fleetmap-images.tar.gz root@<host>:/opt/fleetmap/
ssh root@<host> "cd /opt/fleetmap && ./redeploy.sh"   # git pull + load tar + restart, no build
```

Full walkthrough — first-time setup, the OSRM dataset build, the Supabase self-host, TLS, backups, smoke tests — in [`docs/deployment.md`](docs/deployment.md).

## Docs

- [`CLAUDE.md`](CLAUDE.md) — working brief: stack decisions, conventions, layout, milestone log.
- [`docs/deployment.md`](docs/deployment.md) — VPS deployment guide.
- [`docs/specs/live-tracking-spec.md`](docs/specs/live-tracking-spec.md) — full design doc.
- [`docs/specs/2026-07-08-bubblebox-route-sync-design.md`](docs/specs/2026-07-08-bubblebox-route-sync-design.md) — the order sync + the Bubble Box API contract as shipped.

## Status

Feature-complete for V1 (M1–M19): live tracking, the monitoring console with route replay and schedule adherence, the Bubble Box order sync wired and proven against their real (staging) API, self-hosted Supabase, and the manual dispatch surface retired — orders flow exclusively from the Bubble Box optimizer. Remaining for go-live: Bubble Box's fleet API on their production server, the rider app pointing at the self-hosted Supabase, and per-van rider mapping. See `CLAUDE.md` for the milestone log.
