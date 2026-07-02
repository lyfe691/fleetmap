# fleetmap

Real-time map of a delivery fleet. Each vehicle's phone streams GPS to the backend; an office TV shows every truck moving live, with on-demand route + ETA. Same shape as Uber, minus rider matching.

Full design doc: `docs/specs/live-tracking-spec.md` — that's the source of truth. This file is the working brief.

## Stack

- **Next.js** (App Router, TypeScript) — API route handlers + the dashboard.
- **Supabase** — Postgres, Realtime (live push to the dashboard), Auth + RLS. Managed for V1; self-hosts as its own compose stack at handoff if the client requires on-prem — the app doesn't change.
- **MapLibre GL** (`react-map-gl`) for the map. Tiles from MapTiler/Stadia — **never the public OSM tile server** (against their usage policy).
- **OSRM**, self-hosted (Docker, Switzerland extract) for route lines + ETA — M4.
- **Driver client:** PWA for V1 (`watchPosition` + Screen Wake Lock). Native Expo is the escape hatch if phones go in pockets or run nav up front — not now.
- **Deployment:** Docker on a single VPS (`fleet.ysz.life`) — Caddy (auto-TLS) → standalone Next image → internal OSRM, all in `docker-compose.prod.yml`. Supabase stays managed cloud. Full guide: `docs/deployment.md`.

## Architecture

Phone → `POST /api/location` (authed) → upsert latest onto the vehicle row + append to history → Supabase Realtime broadcasts the vehicle-row change → dashboard moves that marker. Dashboard calls `GET /api/route` (→ OSRM) for routes + ETA.

Keep the API thin: ingest + OSRM proxy only. It stays **stateless** — the live fan-out is Supabase Realtime's job, not the API's. No Redis, no custom WebSocket server.

## Layout

```
app/api/location/route.ts   ingest endpoint
app/api/route/route.ts      OSRM proxy — route line + ETA (GET /api/route)
app/api/dashboard-session/route.ts   mint dashboard session (display code) — TV read identity
app/api/dispatcher-session/route.ts  mint dispatcher session (shared secret)
app/api/ingest/routes/route.ts                    ingestion seam — routes (POST create/update)
app/api/ingest/routes/[external_ref]/route.ts     delete a route — DELETE (cascade stops)
app/api/stops/[id]/route.ts          PATCH stop — dispatcher mutation (status/reassign/reorder)
app/dispatch/page.tsx                 dispatcher console — order intake + management (gate → DispatchConsole)
components/dispatch/dispatch-gate.tsx dispatcher session check → login form or console
components/dispatch/order-form.tsx    new-order screen: customer/date/window/van + map-click location
components/dispatch/orders-list.tsx   orders screen: add return, cancel, reassign, status override
components/dispatch/pin-map.tsx       small click-to-place map (order-intake location, not FleetMapView)
lib/supabase/dispatcher.ts            dispatcher browser client (persistent session, human login)
lib/dispatch/use-dispatch-data.ts     dispatcher's read model (vehicles fetched once, orders/stops refetched on mutation, next-seq calc)
lib/dispatch/actions.ts               dispatcher mutations (create/add-return/cancel/patch-stop) via shared authedFetch
lib/dispatch/use-async-action.ts      shared busy/error/on-success hook for dispatch mutation buttons
scripts/seed-stops.ts                dev-only ingestion adapter #1
docker-compose.yml          OSRM routing container (Switzerland extract) — dev
Dockerfile                  standalone Next image (prod build)
docker-compose.prod.yml     prod stack — Caddy (TLS) → app → OSRM (internal)
caddy/Caddyfile             reverse proxy + auto-TLS for fleet.ysz.life
redeploy.sh                 VPS: git pull + rebuild the prod stack
docs/deployment.md          VPS deploy guide (Hostinger, fleet.ysz.life)
lib/supabase/server.ts      request-scoped Supabase client (runs as the user)
lib/supabase/browser.ts     browser client (publishable key) — dashboard read/Realtime
lib/use-live-vehicles.ts    dashboard vehicles live channel (snapshot + subscribe)
lib/use-live-stops.ts       dashboard stops live channel (snapshot + subscribe)
lib/use-fleet-routes.ts     per-vehicle route cache (fetch on stop-set change)
lib/route-slice.ts          traveled/remaining split (turf, forward-clamped)
lib/use-route-features.ts   per-vehicle traveled/remaining FeatureCollections (cache)
lib/geofence.ts             server-side geofence auto-arrive (POST /api/location)
lib/replay.ts               route-replay math (interpolation, bearing, thinning, stats)
lib/map-theme.ts            MapTiler style + marker palette per light/dark theme
lib/console/use-console-data.ts  ConsoleVehicle view-model (real data + assumed placeholders)
lib/console/assumed.ts      placeholder vehicle/cargo/history data (no telematics yet)
lib/settings/               locale + a11y flags store (localStorage, `useSettings`, `setSetting`)
lib/i18n/                   en/de-CH translation engine — `useTranslations()`, typed key parity
components/theme-provider.tsx     next-themes provider (+ 'd' toggle hotkey)
components/map/dashboard-gate.tsx display-code gate → console
components/map/fleet-map-view.tsx MapLibre map: routes + circular status pins (reused everywhere)
components/console/console-shell.tsx  3-region console (sidebar + fleet rail + main)
components/console/{app-sidebar,fleet-rail,map-view,tracking-view,history-view}.tsx  console views
components/console/settings/        settings dialog (appearance/accessibility/language) + sub-components
app/page.tsx                landing page — links to /dashboard and /dispatch (no auth of its own)
app/dashboard/page.tsx      TV monitoring console (gate → ConsoleShell)
supabase/migrations/        SQL migrations
scripts/cities.ts           dev-only multi-city config — areas + per-city demo orders
scripts/fake-gps.ts         dev-only fake GPS poster (one van per city, drives each route)
scripts/provision-{dashboard,dispatcher,driver}.ts  create the Auth identities (dev/setup, secret key)
scripts/lib/ensure-user.ts  shared idempotent Auth-user provisioning helper
scripts/adapters/csv-to-stops.example.ts  ingestion adapter #2 (reference stub)
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

- `vehicles` — one row per tracked unit, holds the latest position (`last_lat/lng/heading/speed`, `last_seen_at`, `status`) and a nullable dispatcher-set `dest_lat/lng`. One vehicle per driver (`assigned_user_id`, unique). Nullable `area_id` ties it to an operational area (0006). Readable by drivers (own row), the dashboard role (all rows), and the dispatcher role (all rows, select-only, 0007 — populates the `/dispatch` van picker).
- `vehicle_positions` — append-only history.
- `operational_areas` — per-city service regions (`slug`, `name`, `center_lat/lng`, `radius_m`, `color`, optional `boundary` polygon). City reference data; `vehicles.area_id` and `stops.area_id` link into it (0006). (The console no longer renders area overlays — the table is the data model only.)

`supabase/migrations/0001_init.sql` is the authority for the core; `0006_operational_areas.sql` adds the multi-city model.

## Conventions

- **Auth + RLS is the security boundary.** App code accesses the DB as the authenticated user via `createUserClient(token)`, so RLS enforces ownership — the `.eq` filters are for clarity, not security. Every new table gets RLS enabled + explicit policies.
- **Dashboard read path:** the TV reads via a dedicated `dashboard` Auth user carrying an `app_metadata.role='dashboard'` claim + a claim-scoped `select` policy on `vehicles`; its session is minted server-side (`POST /api/dashboard-session`) behind a display code — never anon read-all. The snapshot reads the column-scoped `vehicles_public` view (0003); the browser client auto-refreshes the session and re-arms Realtime auth on refresh (M5). Caveat: live updates still ride `postgres_changes` on `vehicles`, which requires the table `select` policy — so column-scoping bounds the snapshot, not the Realtime payload. The same is true of `stops`: the live channel ships the full row (incl. `address`/`order_id`, which the dashboard never renders) — a known exposure, bounded for now by the display-code gate + office network. The proper fix is moving customer PII off the realtime'd `stops` table (e.g. onto `orders`, already kept off Realtime) in a new migration.
- **The dashboard is the monitoring console.** `app/dashboard` → display-code gate → `ConsoleShell` (`components/console/*`): a 3-region touchscreen layout (sidebar nav + fleet rail + tracking/map/history) on shadcn + next-themes light/dark. `components/map/fleet-map-view.tsx` is the reused, theme-aware map surface (`lib/map-theme.ts`) with circular status pins. Panels without a real source (load, fuel, cargo) use clearly-marked placeholders from `lib/console/assumed.ts` — replace at the seam when telematics data lands. The History tab is real: route replay from `vehicle_positions` (0008 read path, `lib/replay.ts` math, playback UI in `history-view.tsx`).
- **`/dispatch` is the assignment surface.** Bubble Box's export carries no van, so orders arrive unassigned and a human assigns them — no auto-assignment, since real shop/locker/partner coverage rules aren't modeled (see `docs/specs/2026-07-02-dispatch-assignment-surface.md`). `app/dispatch` → `DispatchGate` (`components/dispatch/*`) → a real email/password login against the shared `dispatcher` Auth identity (`lib/supabase/dispatcher.ts`, persistent session — separate from the dashboard's deliberate display-token client). Orders tab (default): a "Needs a van" group (van picker + Assign — PATCHes `vehicle_id` + `seq = base + i` onto each vanless stop) above the assigned list (per-stop status/reassign/unassign, add-return, cancel), with a stat strip on top; the manual order form stays as the second tab for phone orders. Unassigned stops never reach the TV or the geofence — both key on `vehicle_id`. `seq` is always computed client-side as `max(existing seq for that vehicle) + 1` (`stops_vehicle_seq_unique` is scoped per vehicle, not per order). "Add return" is a **direct insert into `stops`**, not a second ingest POST — `ingest_stops` replace-sets (delete+reinsert) an order's whole stop list on every call and its insert never carries `status`, so re-POSTing an order with a completed pickup would silently reset it to `planned`.
- **Operational areas are city reference data.** `operational_areas` (0006) + `area_id` on vehicles/stops model the multi-city fleet (read via the `dashboard` claim; `area_id` rides the `vehicles_public`/`stops_public` views). The dispatcher manages them and the seed scripts populate them. The console rebuild removed the map overlays + the `useOperationalAreas` hook — the table is data only now.
- **The secret key (service-role-equivalent) is dev-only** (`scripts/`). Never use it in a request handler or ship it in a deployed image.
- **i18n + settings:** All console chrome is translated via `useTranslations()` (`lib/i18n/`) with type-enforced de-CH key parity (`de-CH = Record<TranslationKey,string>`). Locale + a11y flags are per-device `localStorage` (`lib/settings/`); a11y flags ride `<html data-*>` attributes + CSS in `globals.css`.
- TypeScript throughout. Route handlers validate input and return `NextResponse.json` with explicit status codes (400 bad input, 401 no/invalid token, 403 wrong shared code/secret, 409 no vehicle, 500 db error).
- SQL: lowercase keywords, snake_case columns, `create ... if not exists`, policies named in plain English.
- Import alias `@/*` → project root.
- Typecheck (`pnpm exec tsc --noEmit`) and run the unit suite (`pnpm test` — vitest, covers `route-slice`, `geofence`, ingest validation) before considering a change done.

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
pnpm test                         # vitest unit suite (route-slice, geofence, ingest validation)
docker compose up -d osrm         # routing engine (build the dataset first — see docker-compose.yml)

# Prod (on the VPS, from /opt/fleetmap)
./redeploy.sh                     # git pull + rebuild the prod stack (docker-compose.prod.yml)
```

Env: `.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

**Demo against prod with fake-gps:** `fake-gps` is a local tool — it needs `SUPABASE_SECRET_KEY` (admin setup + reading stops), which must never live on the VPS. Run it from your machine but point its POSTs at the deployed ingest endpoint, with local OSRM up for route geometry (prod OSRM is internal-only). Since prod reuses the same managed Supabase project, the keys are identical and the fake vans appear on the real TV:

```
FAKE_GPS_API_URL=https://fleet.ysz.life/api/location pnpm fake-gps
```

It writes into the shared Supabase, so a fake van and a real driver in the same city fight over one marker — use it for demos before real drivers stream, not alongside them.

## Milestones

- [x] **M1 — pipe:** schema + `POST /api/location` + fake-GPS poster.
- [x] **M2 — see it move:** dashboard map + Realtime subscription + markers updating live off the fake feed.
- [x] **M3 — driver PWA:** auth + watchPosition + wake lock + POST loop + offline buffer. Retired: the driver client moved to Roman's native Bubblebox app. The web `/driver` route + `components/driver/*` + the driver-only `lib/` hooks (`use-geolocation`, `use-wake-lock`, `use-location-sync`, `driver-status`, `supabase/driver`) were removed 2026-07 once that app was live — the backend they used (`POST /api/location`, `lib/geofence.ts`, the driver RLS policies, `scripts/provision-driver.ts`) is untouched and still what his app authenticates against.
- [x] **M4 — routing:** OSRM container (`docker-compose.yml`) + `GET /api/route` proxy + click-to-route + ETA.
- [x] **M5 — polish:** smooth marker interpolation, offline/stale flags, TV kiosk mode (fullscreen + session refresh), column-scoped read (`vehicles_public`).
- [x] **M6 — order/stop model + ingestion seam:** orders/stops schema + RLS + Realtime, dispatcher identity, POST /api/ingest/routes, seed-stops adapter. The ingestion seam is now full CRUD: create/update via `POST /api/ingest/routes`, delete via `DELETE /api/ingest/routes/:external_ref?source=…` (keyed by `(source, external_ref)`; stops cascade and the TV evicts them via Realtime).
- [x] **M7 — live routes on the TV:** vehicleId-only `/api/route` (multi-waypoint + legs/stopOffsets), `useLiveStops` channel, per-vehicle route lines from real stop data; click-to-route removed.
- [x] **M8 — greying + side rail + ETA:** client-side traveled/remaining split (turf, forward-clamped), shared route sources, next-stop emphasis + terminal fade, fleet side rail (next stop · ETA · stops-left · freshness).
- [x] **M9 — stop lifecycle:** server-side geofence auto-arrive in POST /api/location (two-radius hysteresis, next-stop-by-seq) + driver SELECT RLS (0005) + PATCH /api/stops/:id (dispatcher reassign/reorder/cancel/status); fake-gps drives only; adapter-2 stub.
- [x] **M10 — multi-city + map UI:** `operational_areas` model + `area_id` on vehicles/stops + ingest seam carries `area_id` (0006); per-city overlays + legend + fit-to-fleet viewport + city-grouped side rail; cities config drives multi-van fake-gps + multi-city seed-stops. (The overlays + the old map dashboard were replaced in M11.)
- [x] **M11 — touchscreen monitoring console:** rebuilt the dashboard from the Claude Design handoff as a 3-region console (`components/console/*`: sidebar + fleet rail + tracking/map/history) on shadcn + next-themes light/dark; theme-aware map (`lib/map-theme.ts`) with circular status pins; `ConsoleVehicle` data seam mapping real GPS/route/ETA with placeholder telematics/cargo/history (`lib/console/assumed.ts`). Removed the zone overlays + the old `FleetMap` shell.
- [x] **M12 — dispatcher console + driver PWA cleanup + landing page:** the client (Bubble Box) has no order-export system, so the ingestion seam's manual path becomes permanent, not a stopgap — `app/dispatch` (`components/dispatch/*`): real login against the shared dispatcher identity, a new-order form (map-click location, van picker, date/window), and an orders list (add-return/cancel/reassign/status). New migration `0007` (dispatcher can read `vehicles`). Removed the dead web driver PWA (Roman's native Bubblebox app owns tracking now). Root (`app/page.tsx`) is a landing page again — two authenticated surfaces now exist. See `docs/specs/2026-07-01-dispatcher-console-design.md`.
- [x] **M13 — dispatch as assignment surface:** orders arrive unassigned from the ingest seam (`vehicle_id` was already optional end-to-end) and `/dispatch` assigns them — orders-first layout, "Needs a van" group with per-order Assign, per-stop unassign escape hatch, stat strip; manual form demoted to second tab. `docs/order-ingestion-api.md` is the Bubble Box integration contract. See `docs/specs/2026-07-02-dispatch-assignment-surface.md`.
- [x] **M14 — route replay:** the History tab replays a vehicle's day from `vehicle_positions` — dashboard read path (0008: claim-scoped select + `vehicle_positions_public` view), paginated day fetch + stride thinning, play/pause/scrubber/speed with an interpolated van marker (`lib/replay.ts`, unit-tested), distance/duration/points stats.
- Later: telematics integrate-or-drop decision. ← next

## Workflow

- Claude can update this file as we progress.
- We follow core programming principles: YAGNI, KISS, DRY.
- Claude invokes skills when relevant.