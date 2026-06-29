# fleetmap

Real-time map of a delivery fleet. Each vehicle's phone streams GPS to the backend; an office TV shows every truck moving live, with on-demand route + ETA. Same shape as Uber, minus rider matching.

## Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 16 (App Router, TypeScript) |
| Database / Realtime / Auth | Supabase (Postgres, Realtime, RLS) |
| Map | MapLibre GL via `react-map-gl`; tiles from MapTiler/Stadia |
| Routing + ETA | OSRM, self-hosted (Docker, Switzerland extract) |
| Driver client | Native app (Bubblebox); the V1 web PWA is retired, kept as reference |
| Deployment | Docker on one VPS — Caddy (TLS) → Next → OSRM; Supabase stays managed (see [`docs/deployment.md`](docs/deployment.md)) |

## Architecture

Phone → `POST /api/location` (authed) → upsert latest position onto the vehicle row + append to history → Supabase Realtime broadcasts the change → dashboard moves that marker. The dashboard calls `GET /api/route` (→ OSRM) to fetch route lines and ETAs for each vehicle.

The API is stateless and thin (ingest + OSRM proxy only). Live fan-out is Supabase Realtime's job — no Redis, no custom WebSocket server.

The dashboard is a touchscreen monitoring console: a 3-region layout (sidebar nav + fleet rail + per-vehicle tracking / live map / history) with light/dark theming.

## Setup

**Prerequisites**: Node.js, pnpm, Docker (for OSRM), a Supabase project.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env   # then fill in the values (see below)

# 3. Apply database migrations
supabase db push

# 4. (Optional) Build and start the OSRM routing container
#    See docker-compose.yml for the one-time dataset build steps.
docker compose up -d osrm
```

### Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → Project Settings → API |
| `SUPABASE_SECRET_KEY` | Dev/scripts only — never ship in a deployed image |
| `NEXT_PUBLIC_MAPTILER_KEY` | MapTiler dashboard (restrict by domain before any public deploy) |
| `OSRM_URL` | `http://localhost:5000` in dev; `http://osrm:5000` inside compose |
| `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` / `DASHBOARD_DISPLAY_CODE` | Set when provisioning the dashboard identity |
| `DISPATCHER_EMAIL` / `DISPATCHER_PASSWORD` / `DISPATCHER_INGEST_SECRET` | Set when provisioning the dispatcher identity |

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript type-check (`tsc --noEmit`) |
| `pnpm lint` | ESLint |
| `pnpm fake-gps` | Dev-only: post a moving fake GPS feed (dev server must be running) |
| `pnpm seed-stops` | Dev-only: seed a day of orders/stops (dev server must be running) |
| `pnpm provision-dashboard` | Create the dashboard TV identity |
| `pnpm provision-dispatcher` | Create the dispatcher identity |
| `pnpm provision-driver` | Create a driver identity |
| `docker compose up -d osrm` | Start the OSRM routing engine (build the dataset first — see `docker-compose.yml`) |

## Deployment

The production stack (Caddy + Next + OSRM) runs on a single VPS via `docker-compose.prod.yml`; Supabase stays managed cloud. Full walkthrough — first-time setup, the OSRM dataset build, TLS, and smoke tests — is in [`docs/deployment.md`](docs/deployment.md).

To ship new code, from `/opt/fleetmap` on the box:

```bash
./redeploy.sh   # git pull + rebuild the prod stack
```

To drive a demo feed against the deployed host, run the fake-GPS poster **locally** (it needs the dev-only secret key) but aim its POSTs at prod:

```bash
FAKE_GPS_API_URL=https://fleet.ysz.life/api/location pnpm fake-gps
```

## Docs

- [`CLAUDE.md`](CLAUDE.md) — working brief: stack decisions, conventions, layout, and milestone log.
- [`docs/deployment.md`](docs/deployment.md) — VPS deployment guide.
- [`docs/specs/live-tracking-spec.md`](docs/specs/live-tracking-spec.md) — full design doc (source of truth).

## Status

Through **M11** — multi-city tracking plus a touchscreen monitoring-console rebuild (sidebar + fleet rail + tracking/map/history, light/dark). Milestones M1–M11 are complete; see `CLAUDE.md` for the full list. Next: orders/deliveries model, auto-assigned dropoffs, and route replay.
