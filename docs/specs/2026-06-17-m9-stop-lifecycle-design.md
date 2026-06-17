# M9 — Stop lifecycle: geofence auto-arrive + dispatcher mutations

**Status:** design, approved 2026-06-17 · **Milestone:** M9 · **Extends:** `docs/specs/2026-06-16-monitoring-pivot-design.md` (the M6–M9 design)

This spec covers M9. It **reuses** the data model, RLS posture, ingestion seam, Realtime pattern, and route proxy already designed in the monitoring-pivot doc — read that first; it is the source of truth for everything M9 builds on. The one genuinely new design here is **geofenced auto-arrive**, which the monitoring-pivot doc deliberately deferred (its open-question #3: *"Geofenced auto-arrive vs explicit action — the main optional-complexity lever in M9. Default: explicit for V1."*). On 2026-06-17 we chose to **un-defer it and include geofence in M9**.

## Context

Through M8, the TV greys the driven portion of each route, emphasizes the next stop, fades terminal stops, and shows a side rail with ETA — all driven by a stop's `status` (`planned → arrived → completed | failed | skipped`). But **nothing changes a stop's status yet.** The dev feed (`fake-gps`, plan 001) *simulates* completion by writing `status='completed'` directly with the dev secret key; there is no real mechanism. M9 builds the two real mechanisms:

1. **Geofence auto-arrive** — the truck's live position advances its own next stop, with zero human input (fits the *monitoring* product: drivers just drive).
2. **Explicit dispatcher mutations** — `PATCH /api/stops/:id` for reassign / reorder / cancel / status override (already specified in the monitoring-pivot doc, line: *"Dispatcher mutations … use the same RLS UPDATE path via `PATCH /api/stops/:id`"*).

When M9 lands, the M8 features become driven by reality (real GPS or `fake-gps` driving) instead of a simulation, and the dispatcher can correct the route live.

## Scope

**In scope**
- Geofence auto-arrive evaluated **server-side in `POST /api/location`**.
- One RLS addition: a **driver `SELECT` policy** on own-vehicle stops (the handler runs as the driver and must read the stops it evaluates).
- `PATCH /api/stops/:id` — dispatcher-authed status / `vehicle_id` / `seq` mutation.
- Revert `fake-gps`'s simulated completion (plan 001) — it goes back to just driving; the geofence advances stops.
- Adapter-2 **stub**: a thin mapper sketch from a client export into the existing `POST /api/ingest/stops` contract (no live feed).

**Out of scope (consistent with the monitoring-pivot doc's YAGNI)**
- `order.status` propagation — orders are never published to Realtime and never reach the TV, so cascading order status has no visible effect in V1. Leave `orders.status` as the ingest sets it.
- Per-stop ETA windows beyond next + total.
- **Skip-ahead** when a stop's radius is missed entirely (truck drives past without entering): out of scope; the dispatcher `PATCH` is the recovery path. Documented limitation.
- Tightening the driver `UPDATE` policy to *status-columns-only* (RLS can't restrict columns; needs column GRANTs or a trigger) — separate hardening item, not M9.
- A driver-facing PWA UI for status (buttons): not needed — the geofence covers V1; explicit driver action would be a later milestone.

## Design

### 1. Geofence auto-arrive — server-side in `POST /api/location`

The driver's GPS post already hits `POST /api/location`, which runs **as the authenticated driver** (`createUserClient(token)`) and today validates the body, appends to `vehicle_positions`, and upserts the latest position onto the `vehicles` row. M9 adds a final step, after the position write succeeds:

1. Read the driver's vehicle's **next stop** — the lowest-`seq` row with `status in ('planned','arrived')` for `vehicle_id = <the driver's vehicle>`, ordered by `seq`, limit 1. (Evaluating only the next stop by `seq` is what makes an out-and-back — pickup + dropoff at the same address — complete the pickup before arming the dropoff.)
2. Compute the straight-line (haversine) distance from the just-posted position to that stop.
3. Apply **at most one forward transition** this tick:
   - `planned → arrived` when `distance ≤ ARRIVE_RADIUS_M`.
   - `arrived → completed` (and set `completed_at = now()`) when the stop is already `arrived` **and** `distance > DEPART_RADIUS_M` (the truck has left after arriving).
4. The transition is a normal `UPDATE stops set status=… where id=…`, running as the driver, gated by the driver UPDATE RLS policy. Realtime carries the change to the TV (the existing `stops-live` channel); the dashboard invalidates that vehicle's `stopsKey` and re-fetches the route once — the line advances, the completed stop fades and drops, the next stop is emphasized, "stops-left" decrements.

**Hysteresis (two radii).** `DEPART_RADIUS_M > ARRIVE_RADIUS_M`, so a position jittering around the boundary cannot flap `arrived`↔`planned` or fire completion prematurely. A truck *pulls up* (enters arrive radius → `arrived`) and later *drives off* (leaves depart radius → `completed`).

**Parameters** (env-tunable, sensible defaults; document in `.env.example`):
- `GEOFENCE_ARRIVE_RADIUS_M` — default `60`
- `GEOFENCE_DEPART_RADIUS_M` — default `120`

Because OSRM routes *to* each stop's exact coordinate, the driven line passes essentially through every stop, so even small radii fire reliably for both `fake-gps` and a real driver.

**Idempotency / safety.** Transitions are forward-only and keyed on the current `status`, so re-posting the same position is a no-op (a `planned` stop already flipped to `arrived` won't re-flip; a `completed` stop is terminal and the "next stop" query skips it). If the vehicle has no active stops, the geofence step is a no-op. A geofence failure must **not** fail the position write — wrap it so a bad geofence evaluation logs and returns the normal `200` for the location post.

### 2. RLS addition — driver `SELECT` on own-vehicle stops

`0004` ships a driver **UPDATE** policy (`"drivers can update their own vehicle stops"`) but **no driver `SELECT` policy**, so today a driver token cannot read `stops`. The geofence step needs to read the next stop. M9 adds a migration with a driver `SELECT` policy scoped exactly like the UPDATE one:

```sql
create policy "drivers can read their own vehicle stops"
  on stops for select to authenticated
  using (
    exists (
      select 1 from vehicles v
      where v.id = stops.vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  );
```

A driver reading their own assigned stops (including `address`) is operationally legitimate — it's their route. The PII boundary is unchanged: the **dashboard** still reads only the column-scoped `stops_public`; only the driver who owns the stop can read its base row.

### 3. Explicit `PATCH /api/stops/:id` (per the monitoring-pivot doc)

A new route handler `app/api/stops/[id]/route.ts`, dispatcher-authed (Bearer token minted via the existing `POST /api/dispatcher-session`; runs as the `dispatcher` role so the existing dispatcher RLS UPDATE policy is the boundary):

- Accepts a JSON body with any of: `status` (`arrived|completed|failed|skipped`), `vehicle_id` (reassign), `seq` (reorder). Validate types/enums; reject unknown fields.
- On `status = completed`, stamp `completed_at`.
- Returns `NextResponse.json` with the project's status codes: `400` bad input, `401` no/invalid token, `404` no such stop (or the RLS-filtered miss), `500` db error.
- Coexists with the geofence: both write `status`; last-write-wins via Realtime. The dispatcher can override to `failed`/`skipped`; the geofence only does forward `planned→arrived→completed` on the next stop, so they rarely contend.

Reorder note: `stops` has `unique (vehicle_id, seq) deferrable initially deferred`, so swapping two stops' `seq` must happen in one transaction (the doc already accounts for this). A single-stop `PATCH` that changes `seq` into an occupied slot is a dispatcher error → surface a `409`; bulk reorder is a later concern.

### 4. `fake-gps` reverts to just driving

Plan 001 added `completeStop()` admin-writes so the simulation could advance stops. With the server geofence, that's redundant and now *wrong* (two mechanisms). M9 **removes** the `completeStop` calls and the stop-status writes from `scripts/fake-gps.ts`; it goes back to: read stops → drive the OSRM route → POST positions. The server geofence advances the stops from those posts — identical to a real driver. (`getActiveStops` returning `id` can stay or be trimmed; the stop-offset machinery is no longer needed for completion.)

### 5. Adapter-2 stub

A non-wired sketch (`scripts/` or `docs/`) showing how a client export (CSV/webhook/ERP row) maps into the `POST /api/ingest/stops` contract — proving the seam holds without building a live feed. No app change; mirrors how adapter-1 (`seed-stops.ts`) posts.

## Data flow

```
real driver / fake-gps  ──POST /api/location (as driver)──►  save position
                                                              │
                                                              ├─ read next stop (driver SELECT RLS)
                                                              ├─ haversine(pos, stop)
                                                              └─ UPDATE stop status (driver UPDATE RLS)
                                                                      │
                                                   Supabase Realtime (stops-live)
                                                                      │
                                                              TV: invalidate stopsKey → re-fetch route once → advance

dispatcher  ──PATCH /api/stops/:id (as dispatcher)──►  UPDATE stop  ──Realtime──►  TV advances (same path)
```

## Edge cases & limitations

- **Missed radius** (truck drives past without entering `ARRIVE_RADIUS_M`): next stop stays `planned`, route doesn't advance. Recovery = dispatcher `PATCH`. Documented; skip-ahead deferred.
- **Clustered urban stops / out-and-back:** next-stop-only-by-`seq` evaluation prevents completing a later stop early.
- **GPS jitter at the boundary:** two-radius hysteresis.
- **Geofence vs dispatcher contention:** last-write-wins; forward-only geofence rarely fights an explicit override.
- **Geofence evaluation error:** never fails the position write (the location POST still returns `200`).

## Verification

No automated test suite (project norm) → gate is `pnpm exec tsc --noEmit` clean (only the known `components/ui/calendar.tsx` shadcn error) plus manual acceptance:

- With OSRM + dev server + seeded stops, run `pnpm fake-gps`. As the truck passes each stop, the TV shows that stop go **arrived then completed** within a Realtime tick, the grey route advances, the completed stop fades and drops, and "stops-left" decrements — **with no status writes from `fake-gps`** (confirm in logs/DB that the server did it).
- Mint a dispatcher token and `PATCH /api/stops/:id` a stop's status / `vehicle_id` / `seq`; the TV reflects it within one tick.
- `PATCH` with bad input returns `400`; no token returns `401`.

## Constraints honored ("Don'ts")

No Redis · no bespoke WebSocket (Supabase Realtime) · RLS is the boundary (driver SELECT/UPDATE scoped to own vehicle; dispatcher PATCH via the dispatcher role) · no broad read-all · OSRM internal · stateless API (geofence is a per-request evaluation, no stored geofence state beyond the stop's own `status`) · the secret key stays dev-only (the geofence runs as the driver, not the secret) · YAGNI/KISS/DRY (one new endpoint, one geofence step, one RLS policy; order-status cascade and skip-ahead deferred).

## Open questions (non-blocking)

1. **Radii defaults** (`60` / `120` m) — tune during acceptance against the Zürich seed; env-overridable so no code change to adjust.
2. **Adapter-2 source** — still unknown what the client's system exposes (the monitoring-pivot doc's open-question #1); the stub just demonstrates the mapping shape.
