# fleetmap

Real-time map of a delivery fleet. Each vehicle's phone streams GPS to the backend; an office TV shows every truck moving live, with on-demand route + ETA. Same shape as Uber, minus rider matching.

Full design doc: `docs/specs/live-tracking-spec.md` — that's the source of truth. This file is the working brief.

## Stack

- **Next.js** (App Router, TypeScript) — API route handlers + the dashboard.
- **Supabase** — Postgres, Realtime (live push to the dashboard), Auth + RLS. Managed for V1; self-hosts as its own compose stack at handoff if the client requires on-prem — the app doesn't change.
- **MapLibre GL** (`react-map-gl`) for the map. Tiles from MapTiler/Stadia — **never the public OSM tile server** (against their usage policy).
- **OSRM**, self-hosted (Docker, Switzerland extract) for route lines + ETA — M4.
- **Driver client:** PWA for V1 (`watchPosition` + Screen Wake Lock). Native Expo is the escape hatch if phones go in pockets or run nav up front — not now.
- **Deployment:** Docker containers.

## Architecture

Phone → `POST /api/location` (authed) → upsert latest onto the vehicle row + append to history → Supabase Realtime broadcasts the vehicle-row change → dashboard moves that marker. Dashboard calls `GET /api/route` (→ OSRM) for routes + ETA.

Keep the API thin: ingest + OSRM proxy only. It stays **stateless** — the live fan-out is Supabase Realtime's job, not the API's. No Redis, no custom WebSocket server.

## Layout

```
app/api/location/route.ts   ingest endpoint
app/api/route/route.ts      OSRM proxy — route line + ETA (GET /api/route)
app/api/dispatcher-session/route.ts  mint dispatcher session (shared secret)
app/api/ingest/stops/route.ts        ingestion seam — orders/stops (POST)
app/api/stops/[id]/route.ts          PATCH stop — dispatcher mutation (status/reassign/reorder)
scripts/seed-stops.ts                dev-only ingestion adapter #1
docker-compose.yml          OSRM routing container (Switzerland extract)
lib/supabase/server.ts      request-scoped Supabase client (runs as the user)
lib/supabase/browser.ts     browser client (publishable key) — dashboard read/Realtime
lib/use-live-stops.ts       dashboard stops live channel (snapshot + subscribe)
lib/use-fleet-routes.ts     per-vehicle route cache (fetch on stop-set change)
lib/route-slice.ts          traveled/remaining split (turf, forward-clamped)
lib/geofence.ts             server-side geofence auto-arrive (POST /api/location)
lib/use-operational-areas.ts  operational-area overlays — snapshot fetch + circle geometry
app/dashboard/page.tsx      TV dashboard (map + live markers)
app/driver/page.tsx         driver PWA (login + GPS streaming + offline buffer)
lib/supabase/driver.ts      driver client (persistent session)
supabase/migrations/        SQL migrations
scripts/cities.ts           dev-only multi-city config — areas + per-city demo orders
scripts/fake-gps.ts         dev-only fake GPS poster (one van per city, drives each route)
docs/specs/live-tracking-spec.md  full spec
```

## Setup (first run)

Package manager is **pnpm**. Project was scaffolded with shadcn CLI v4 (Next.js App Router + TypeScript, Base UI primitives, custom preset):

```
pnpm dlx shadcn@latest init --preset b1VlIttI --base base --template next --pointer
# name it: fleetmap
```

Then from the project root: `pnpm add @supabase/supabase-js`, `pnpm add -D tsx`, copy `.env.example` → `.env` (fill the Supabase keys), apply `supabase/migrations/0001_init.sql`.

## Data model

- `vehicles` — one row per tracked unit, holds the latest position (`last_lat/lng/heading/speed`, `last_seen_at`, `status`) and a nullable dispatcher-set `dest_lat/lng`. One vehicle per driver (`assigned_user_id`, unique). Nullable `area_id` ties it to an operational area (0006).
- `vehicle_positions` — append-only history.
- `operational_areas` — per-city service regions (`slug`, `name`, `center_lat/lng`, `radius_m`, `color`, optional `boundary` polygon). Static reference data the TV draws as soft overlays; `vehicles.area_id` and `stops.area_id` link into it (0006).

`supabase/migrations/0001_init.sql` is the authority for the core; `0006_operational_areas.sql` adds the multi-city model.

## Conventions

- **Auth + RLS is the security boundary.** App code accesses the DB as the authenticated user via `createUserClient(token)`, so RLS enforces ownership — the `.eq` filters are for clarity, not security. Every new table gets RLS enabled + explicit policies.
- **Dashboard read path:** the TV reads via a dedicated `dashboard` Auth user carrying an `app_metadata.role='dashboard'` claim + a claim-scoped `select` policy on `vehicles`; its session is minted server-side (`POST /api/dashboard-session`) behind a display code — never anon read-all. The snapshot reads the column-scoped `vehicles_public` view (0003); the browser client auto-refreshes the session and re-arms Realtime auth on refresh (M5). Caveat: live updates still ride `postgres_changes` on `vehicles`, which requires the table `select` policy — so column-scoping bounds the snapshot, not the Realtime payload.
- **Operational areas are static reference data.** The TV reads them via the same `dashboard` claim (a `select` policy on `operational_areas`, 0006); the dispatcher manages them. No Realtime publication — boundaries don't move, so `useOperationalAreas` snapshots once on load. Areas are rendered low-opacity beneath routes/markers; `area_id` rides the `vehicles_public`/`stops_public` views for city grouping on the TV.
- **The secret key (service-role-equivalent) is dev-only** (`scripts/`). Never use it in a request handler or ship it in a deployed image.
- TypeScript throughout. Route handlers validate input and return `NextResponse.json` with explicit status codes (400 bad input, 401 no/invalid token, 409 no vehicle, 500 db error).
- SQL: lowercase keywords, snake_case columns, `create ... if not exists`, policies named in plain English.
- Import alias `@/*` → project root.
- Typecheck (`pnpm exec tsc --noEmit`) before considering a change done; there's no test suite yet.

## Don'ts (already decided — don't relitigate)

- Don't add a broad "read all vehicles" RLS policy. The TV reads via a dedicated dashboard identity + claim-scoped policy (decided in M2 — display token, not anon read).
- Don't reach for the public OSM tile server.
- Don't build a bespoke realtime/WebSocket layer — Supabase Realtime handles it.
- Don't add Redis. It only earns its place if a custom multi-instance socket layer ever exists, which it doesn't.
- Vendor-neutrality is not a goal for V1. Don't rearchitect to avoid Supabase; self-hosting is a handoff-time deployment change.

## Commands

```
pnpm dev                          # Next dev server
pnpm fake-gps                     # dev-only: moving fake feed (dev server must be running)
pnpm provision-dispatcher         # create the dispatcher identity (role=dispatcher)
pnpm seed-stops                   # dev-only: seed a day of orders/stops (dev server running)
supabase db push                  # apply migrations
pnpm exec tsc --noEmit            # typecheck
docker compose up -d osrm         # routing engine (build the dataset first — see docker-compose.yml)
```

Env: `.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

## Milestones

- [x] **M1 — pipe:** schema + `POST /api/location` + fake-GPS poster.
- [x] **M2 — see it move:** dashboard map + Realtime subscription + markers updating live off the fake feed.
- [x] **M3 — driver PWA:** auth + watchPosition + wake lock + POST loop + offline buffer.
- [x] **M4 — routing:** OSRM container (`docker-compose.yml`) + `GET /api/route` proxy + click-to-route + ETA.
- [x] **M5 — polish:** smooth marker interpolation, offline/stale flags, TV kiosk mode (fullscreen + session refresh), column-scoped read (`vehicles_public`).
- [x] **M6 — order/stop model + ingestion seam:** orders/stops schema + RLS + Realtime, dispatcher identity, POST /api/ingest/stops, seed-stops adapter.
- [x] **M7 — live routes on the TV:** vehicleId-only `/api/route` (multi-waypoint + legs/stopOffsets), `useLiveStops` channel, per-vehicle route lines from real stop data; click-to-route removed.
- [x] **M8 — greying + side rail + ETA:** client-side traveled/remaining split (turf, forward-clamped), shared route sources, next-stop emphasis + terminal fade, fleet side rail (next stop · ETA · stops-left · freshness).
- [x] **M9 — stop lifecycle:** server-side geofence auto-arrive in POST /api/location (two-radius hysteresis, next-stop-by-seq) + driver SELECT RLS (0005) + PATCH /api/stops/:id (dispatcher reassign/reorder/cancel/status); fake-gps drives only; adapter-2 stub.
- [x] **M10 — multi-city + map UI:** `operational_areas` model + `area_id` on vehicles/stops + ingest seam carries `area_id` (0006); soft low-opacity per-city overlays (Zürich/Bern/Basel) + legend + fit-to-fleet viewport + city-grouped side rail; top-down car pointer; cities config drives multi-van fake-gps + multi-city seed-stops.
- Later: orders/deliveries model, auto-assigned dropoffs + status, route replay. ← next

## Workflow

- Claude can update this file as we progress.
- We follow core programming principles: YAGNI, KISS, DRY.
- Claude invokes skills when relevant.