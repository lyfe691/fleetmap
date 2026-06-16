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
lib/supabase/server.ts      request-scoped Supabase client (runs as the user)
lib/supabase/browser.ts     browser client (publishable key) — dashboard read/Realtime
app/dashboard/page.tsx      TV dashboard (map + live markers)
supabase/migrations/        SQL migrations
scripts/fake-gps.ts         dev-only fake GPS poster
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

- `vehicles` — one row per tracked unit, holds the latest position (`last_lat/lng/heading/speed`, `last_seen_at`, `status`) and a nullable dispatcher-set `dest_lat/lng`. One vehicle per driver (`assigned_user_id`, unique).
- `vehicle_positions` — append-only history.

`supabase/migrations/0001_init.sql` is the authority.

## Conventions

- **Auth + RLS is the security boundary.** App code accesses the DB as the authenticated user via `createUserClient(token)`, so RLS enforces ownership — the `.eq` filters are for clarity, not security. Every new table gets RLS enabled + explicit policies.
- **Dashboard read path:** the TV reads via a dedicated `dashboard` Auth user carrying an `app_metadata.role='dashboard'` claim + a claim-scoped `select` policy on `vehicles`; its session is minted server-side (`POST /api/dashboard-session`) behind a display code — never anon read-all. Column-scoping (a `vehicles_public` view) and token refresh are M5.
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
supabase db push                  # apply migrations
pnpm exec tsc --noEmit            # typecheck
```

Env: `.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`.

## Milestones

- [x] **M1 — pipe:** schema + `POST /api/location` + fake-GPS poster.
- [x] **M2 — see it move:** dashboard map + Realtime subscription + markers updating live off the fake feed.
- [ ] **M3 — driver PWA:** auth + watchPosition + wake lock + POST loop + offline buffer. ← next
- [ ] M4 — routing: OSRM container + `/api/route` proxy + click-to-route + ETA.
- [ ] M5 — polish: smooth marker interpolation, offline/stale flags, TV kiosk mode, lock down RLS.
- Later: orders/deliveries model, auto-assigned dropoffs + status, geofenced "arrived" events, route replay.

## Workflow

- Claude can update this file as we progress.
- We follow core programming principles: YAGNI, KISS, DRY.
- Claude invokes skills when relevant.