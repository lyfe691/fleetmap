# fleetmap

Real-time map of a delivery fleet. Each vehicle's phone streams GPS to the backend; an office TV shows every truck moving live, with on-demand route + ETA. Same shape as Uber, minus rider matching.

Full design doc: `live-tracking-spec.md` — that's the source of truth. This file is the working brief.

## Stack

- **Next.js** (App Router, TypeScript) — API route handlers now, the dashboard later.
- **Supabase** — Postgres, Realtime (live push to the dashboard), Auth + RLS. Hosted now; self-hostable later — either is fine, the app doesn't care.
- **MapLibre GL** (`react-map-gl`) for the map. Tiles from MapTiler/Stadia — **never the public OSM tile server** (against their usage policy).
- **OSRM**, self-hosted (Docker, Switzerland extract) for route lines + ETA — M4.
- **Driver client:** PWA for V1 (`watchPosition` + Screen Wake Lock). Native Expo is the escape hatch if phones go in pockets or run nav up front — not now.
- **Deployment:** Docker containers.

## Architecture

Phone → `POST /api/location` (authed) → upsert latest onto the vehicle row + append to history → Supabase Realtime broadcasts the vehicle-row change → dashboard moves that marker. Dashboard calls `GET /api/route` (→ OSRM) for routes + ETA.

Keep the API thin: ingest + OSRM proxy only. It stays **stateless** — the live fan-out is Supabase Realtime's job, not the API's.

## Layout

```
app/api/location/route.ts   ingest endpoint
lib/supabase/server.ts      request-scoped Supabase client (runs as the user)
supabase/migrations/        SQL migrations
scripts/fake-gps.ts         dev-only fake GPS poster
live-tracking-spec.md       full spec
```

## Data model

- `vehicles` — one row per tracked unit, holds the latest position (`last_lat/lng/heading/speed`, `last_seen_at`, `status`) and a nullable dispatcher-set `dest_lat/lng`. One vehicle per driver (`assigned_user_id`, unique).
- `vehicle_positions` — append-only history.

`supabase/migrations/0001_init.sql` is the authority.

## Conventions

- **Auth + RLS is the security boundary.** App code accesses the DB as the authenticated user via `createUserClient(token)`, so RLS enforces ownership — the `.eq` filters are for clarity, not security. Every new table gets RLS enabled + explicit policies.
- **Service role is dev-only** (`scripts/`). Never use it in a request handler or ship it in a deployed image.
- TypeScript throughout. Route handlers validate input and return `NextResponse.json` with explicit status codes (400 bad input, 401 no/invalid token, 409 no vehicle, 500 db error).
- SQL: lowercase keywords, snake_case columns, `create ... if not exists`, policies named in plain English.
- Import alias `@/*` → project root.
- Typecheck (`npx tsc --noEmit`) before considering a change done; there's no test suite yet.

## Don'ts (already decided — don't relitigate)

- Don't add a broad "read all vehicles" RLS policy. The TV read path (display token vs anon read) is a deliberate M2 decision.
- Don't reach for the public OSM tile server.
- Don't build a bespoke realtime/WebSocket layer — Supabase Realtime handles it.
- Vendor-neutrality is not a goal. Don't rearchitect to avoid Supabase.

## Commands

```
npm run dev                    # Next dev server
npx tsx scripts/fake-gps.ts    # dev-only: post a moving fake feed (server must be running)
supabase db push               # apply migrations (or paste SQL into the dashboard)
npx tsc --noEmit               # typecheck
```

Env: see `.env.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## Milestones

- [ ] **M1 — pipe:** schema + `POST /api/location` + fake-GPS poster.
- [ ] **M2 — see it move: dashboard map + Realtime subscription + markers updating live off the fake feed. ← next**
- [ ] M3 — driver PWA: auth + watchPosition + wake lock + POST loop + offline buffer.
- [ ] M4 — routing: OSRM container + `/api/route` proxy + click-to-route + ETA.
- [ ] M5 — polish: smooth marker interpolation, offline/stale flags, TV kiosk mode, lock down RLS.
- Later: orders/deliveries model, auto-assigned dropoffs + status, geofenced "arrived" events, route replay.

## Workflow

- Claude can update this as we progress.
- We follow core progamming principles such as YAGNI, KISS and DRY.
- Claude invokes skills if needed.