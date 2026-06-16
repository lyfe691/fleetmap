# Monitoring pivot — order/stop model, ingestion seam, route-driven TV

**Status:** design, approved 2026-06-16 · **Milestones:** M6–M9 · **Supersedes:** the M4 click-to-route interaction model

## Context

The real customer is a laundry/clothes-washing company: it picks up dirty laundry, washes it at a facility, and delivers it back clean. The deliverable is an **office-TV monitoring display**.

V1 (M1–M5) shipped live vehicle tracking + on-demand routing. But M4's interaction — click a van, click the map, set a destination — is the **wrong model** for this customer. The TV is for **passive monitoring**, not dispatch. Routes and destinations must come from **real order/stop data**, not manual clicks. The TV should show every truck, its planned route, its next stop, an ETA, and grey out the portion already driven.

The data source is undecided ("we don't know yet what their existing system exposes"). The design must therefore put a single **swappable ingestion seam** in front of order/stop data, so *how* it arrives (manual entry now, a feed later) never touches the map, schema, RLS, or Realtime.

This pivot turns "trucks moving on a map" into "trucks running real delivery routes."

## The pivot, in one line

The TV stops being something you click. Each truck has an **ordered list of stops** (its route); the map line is a *derived projection* of "current position → remaining stops" through OSRM, fetched live and never stored.

## Decisions

- **Route shape (standard last-mile idiom):** the durable truth is a **sequenced stop list**; the polyline is a cheap, regenerable projection. One order → up to two stops (`pickup`, `dropoff`). A single stop `status` (`planned → arrived → completed | failed | skipped`) drives the route line, the next-stop panel, and the grey boundary. A separate stored-route entity was rejected — it creates a cache-invalidation surface and tempts broadcasting a large geometry blob over Realtime.
- **Delivery leg:** the TV shows **all assigned non-terminal stops** for a truck, pickup or return, rendered identically. We do **not** build wash-lifecycle orchestration. A return delivery is just a `dropoff` stop ingested whenever it's known. `orders.status` stays minimal.
- **Fleet size:** small (well under 20). Render every truck's route simultaneously via shared FeatureCollection sources. No rotating-highlight complexity.
- **TV layout:** **map + fixed fleet side rail** (~75% map / 25% rail). The rail lists every truck — status dot, next stop, ETA, stops-left — and is where idle/stale/offline trucks live even with no route drawn.
- **Deferred (YAGNI):** per-stop ETA windows beyond next + total; geofenced auto-arrive (explicit status updates for V1); facility/wash state on the TV.

## Data model (migration `0004`)

### `orders` (new)
The customer laundry job (one job = a pickup + a return). The stable business entity the ingestion seam writes, decoupled from which vehicle serves it. **The only table that may hold customer PII** (`customer_name`, address). Deliberately **never added to the Realtime publication** and has **no dashboard read policy** — PII cannot reach the TV by either path.

| column | notes |
|---|---|
| `id uuid pk` | `default gen_random_uuid()` |
| `external_ref text` | source-system id; idempotency key for re-ingest |
| `source text not null default 'manual'` | which adapter created it (`manual` \| feed name); part of the idempotency key |
| `customer_name text` | PII — orders-only, never published |
| `status text not null default 'new'` | check in (`new`,`assigned`,`in_progress`,`completed`,`cancelled`) — coarse; only what the seam needs for idempotency/cancellation |
| `scheduled_date date` | |
| `created_at / updated_at timestamptz default now()` | |
| `unique (source, external_ref)` | a feed and the manual form can't clobber each other |

**RLS:** enabled. Dispatcher `insert/update/select` policy keyed to `app_metadata.role='dispatcher'`. No dashboard policy, not published to Realtime. No driver access.

### `stops` (new)
The canonical map entity: a sequenced location task assigned to a vehicle. Drives the route line, next-stop panel, and grey logic. One order yields up to two stops. The lowest-`seq` non-terminal stop for a vehicle is its "next stop"; terminal stops drop out of the remaining route. Reassign/reorder/cancel are plain UPDATEs; Realtime carries them to the TV and the route re-fetches.

| column | notes |
|---|---|
| `id uuid pk` | `default gen_random_uuid()` |
| `order_id uuid` | `references orders(id) on delete cascade` |
| `vehicle_id uuid` | `references vehicles(id) on delete set null` — nullable: unassigned stops aren't on a route yet |
| `stop_type text not null` | check in (`pickup`,`dropoff`) |
| `seq int not null` | visit order within the vehicle's route; drives OSRM waypoint order |
| `lat / lng double precision not null` | denormalized so no PII join is needed at render |
| `address text` | server-side only; **excluded from `stops_public`** |
| `status text not null default 'planned'` | check in (`planned`,`arrived`,`completed`,`failed`,`skipped`) |
| `eta_at timestamptz` | optional planned window, displayed if present (not computed by us in V1) |
| `completed_at timestamptz` | |
| `created_at timestamptz default now()` | |
| `unique (vehicle_id, seq) deferrable initially deferred` | lets a reorder swap seqs in one transaction |

**RLS:** enabled. Dispatcher `insert/update` policy (`role='dispatcher'`). Dashboard claim-scoped `select` policy (`role='dashboard'`, mirrors `0002`). A driver self-update policy scoped to `vehicle_id = own assigned vehicle`, restricted to status transitions — **named in the M6 migration** (used in M9 for optional geofence auto-arrive) so the security boundary exists from day one. Added to the `supabase_realtime` publication (same do-block guard as `0002`) with **`REPLICA IDENTITY FULL`** so DELETE payloads carry `vehicle_id` (needed to evict the right bucket on reassignment).

### `stops_public` (new view, mirrors `vehicles_public`)
Column-scoped projection the TV **snapshot** reads, `security_invoker = true` so the dashboard claim policy still gates rows. Columns: `id, vehicle_id, stop_type, seq, lat, lng, status, eta_at` — omits `order_id`, `address`, `completed_at`, `created_at`. `grant select to authenticated` (mirrors `0003`).

> **PII boundary:** Realtime rides the base `stops` table (postgres_changes cannot subscribe to a view), so the view only scopes the *snapshot*. The real defense is structural: all customer PII lives on `orders` (never published); `stops` carries no customer name, and `address` is dropped from `stops_public` and never rendered from the live payload. **Any new column added to `stops` must respect this.**

### `vehicles` / `vehicle_positions` (unchanged)
No DDL change. `dest_lat/lng` stay nullable and **unused** — an earlier idea to repurpose them as a next-stop cache was rejected (adversarial review proved `vehicles_public` and the live-vehicles hook both omit those columns, so the TV would never see the cache; it is also a redundant second source of truth). Next-stop comes from the `stops` channel. The `vehicles` Realtime payload stays position-only.

## Architecture

### Ingestion seam — the swappable boundary
`POST /api/ingest/stops` is the **only** writer of orders/stops. It validates a fixed contract and commits; *how* the payload is produced is an adapter concern that never touches schema/RLS/Realtime/TV.

Contract:
```
{ orders: [ {
    external_ref, source?, customer_name?, scheduled_date?,
    stops: [ { stop_type:'pickup'|'dropoff', vehicle_id, seq, lat, lng, address?, eta_at? } ]
} ] }
```

- **Auth:** the endpoint runs as a dedicated `dispatcher` Auth user (`app_metadata.role='dispatcher'`) via `createUserClient(token)`, so RLS is the write boundary. The token comes from a new `POST /api/dispatcher-session` (shared-secret header → mints a short-lived dispatcher JWT), mirroring `/api/dashboard-session` + the dashboard-code pattern exactly. This gives both the dev seed script and an unattended machine-to-machine feed one consistent way to obtain a token (no interactive login, no secret key in a handler).
- **Atomicity:** the multi-statement mutation (upsert `orders` by `(source, external_ref)`, replace-set that order's `stops`) runs inside one Postgres function (rpc) invoked by the thin handler, so a partial write can't leave dangling stops. The handler stays stateless — no queue, no background job, no cross-request debounce (that would be smuggled state). Routing happens lazily on the TV's read, not on ingest.
- **Adapters:** #1 = `scripts/seed-stops.ts` (dev-only manual-JSON poster, mints via `/api/dispatcher-session` like `fake-gps` signs in). #2 (later, no app change) = a thin mapper from the client's export (CSV/webhook/ERP) into the same contract, POSTing server-to-server. Dispatcher mutations that aren't new orders (reassign/reorder/cancel/mark-failed) use the same RLS UPDATE path via `PATCH /api/stops/:id` and propagate via Realtime — no separate mechanism.

### Realtime — reuse the M2 pattern, one more table
Migration adds `stops` to the `supabase_realtime` publication (do-block guard as in `0002`) with `REPLICA IDENTITY FULL`, plus the dashboard claim-scoped select policy. `orders` is **not** published. The TV opens a second `postgres_changes` subscription (channel `stops-live`, `table:'stops'`, `event:'*'`) on the **same display-token session** as the existing `vehicles-live` channel — one client, both channels re-armed together on `TOKEN_REFRESHED` (the existing `setAuth` handler already covers this; no Redis, no new socket).

A `useLiveStops` hook mirrors `useLiveVehicles`: snapshot-read `stops_public` on `SUBSCRIBED`, then apply INSERT/UPDATE/DELETE into a `byVehicle` map keyed by `vehicle_id` (last-write-wins; the snapshot must not clobber a newer live event). Two independent streams reconciled client-side by `vehicle_id`:
- a **position** update (vehicles channel) re-runs the client-side line-slice against the already-fetched geometry — **no OSRM call**;
- a **stop** update (status/reassign/resequence) invalidates that vehicle's `stopsKey` and triggers a single `/api/route` re-fetch.

Out-of-order arrivals self-heal: a late position re-slices, a late stop re-fetches. **Geometry never travels on Realtime** (it isn't stored at all).

### Route proxy — multi-waypoint, server-resolved
`GET /api/route` is generalized from "2 caller-supplied points + `positionKey`" to **`vehicleId`-only**. Running as the dashboard role via `createUserClient(token)`:
1. read the vehicle's live `last_lat/lng`;
2. read its non-terminal stops (`status in planned, arrived`) ordered by `seq` (RLS-gated by the dashboard claim);
3. build the OSRM coordinate list as `live-position;stop1;…;stopN` (lng,lat order);
4. one proxied OSRM `/route/v1/driving` call with `overview=full&geometries=geojson` — `routes[0].legs[]` is present by default (one leg per waypoint pair);
5. compute each stop's offset along the returned LineString (cumulative leg distances, or turf `nearestPointOnLine`).

Response:
```
{ geometry, totalDuration, totalDistance,
  legs: [ { toStopId, duration, distance } ],
  stopOffsets: [ { stopId, seq, lineFraction } ],
  stops: [ { id, seq, stop_type, lat, lng, status } ] }
```
`legs[]` + `stopOffsets[]` are explicit M7 plumbing — M8's ETA-to-next (`legs[0].duration`) and grey-clamp both depend on them. **Geometry is fetched live, never stored**; re-fetch is gated on `stopsKey` (stop ids + seq + status), **not** on GPS pings — this kills M4's per-position OSRM refetch (`lib/use-route.ts`). OSRM stays internal behind the proxy.

> Edge cases (acceptable for monitoring): `/route` does not reorder waypoints, so `seq` is treated as the true visit order; an overshot next stop can briefly route backward and skew ETA; clustered urban stops can snap to a ~0 first leg (show an "arriving" state under a small threshold).

### TV rendering — layout B (map + fleet side rail)
The M4 `onClick`/`setDest` handler, crosshair cursor, `DestPin`, and dest-driven `RoutePanel` are **removed** — the core of the pivot. Full-bleed MapLibre map (~75%) auto-fit to all active vehicles' remaining stops, with a fixed **fleet side rail** (~25%) listing every truck: status dot (active/idle/stale), label, next stop type, ETA-to-next, stops-left.

- **Fleet-scale lines:** ONE shared GeoJSON FeatureCollection source for all **remaining** segments and ONE for all **traveled** segments, features keyed by `vehicle_id`, styled by data-driven paint — layer count stays flat (~4 line layers) regardless of fleet size. Remaining = blue (width 4, opacity 0.85, the existing route-line style); traveled = grey (`#9ca3af`, opacity ~0.4) rendered **under** it.
- **The split** is computed client-side per position update: turf `nearestPointOnLine(geometry, truckPos)` → `lineSlice(start, snap)` = traveled, `lineSlice(snap, end)` = remaining (~1–5 ms for CH routes); only the two source `data`s are swapped via `setData`.
- **Out-and-back fix (critical for laundry):** pickup-then-return-to-same-address makes `nearestPointOnLine` liable to snap to the wrong limb. Clamp the snap to be at or after the last completed stop's offset (`stopOffsets[]`) and constrain the search to a forward window from the last snap — a tiny per-vehicle progress scalar (last `lineFraction`), a deliberate departure from pure stateless-per-ping.
- **Markers:** next stop (lowest-seq non-terminal) emphasized (larger pin, pickup vs dropoff icon); later stops small dots; terminal stops faded. Vehicle markers reuse the existing `InterpolatedMarker` glide + heading + stale-grey logic untouched. Idle vehicles (no non-terminal stops) draw no line, sit in the rail. Offline/stale grey out as today.
- **Rail rows** reuse the read-only `RoutePanel` content (type, ETA-to-next via `formatEta(legs[0].duration)`, stops-remaining, a "last updated Xs ago" freshness badge from `last_seen_at` to flag stale ETAs).

## Milestones

| M | Title | Scope | Acceptance |
|---|---|---|---|
| **M6** | Order/stop model + ingestion seam + dispatcher identity | Migration `0004` (orders, stops, RLS incl. named driver self-update policy, `stops` → publication w/ `REPLICA IDENTITY FULL`, `stops_public`; orders unpublished). `POST /api/dispatcher-session` + `provision-dispatcher.ts` + `.env.example` entries. `POST /api/ingest/stops` (validate, commit via one rpc, runs as dispatcher). `scripts/seed-stops.ts` (adapter #1). | Seed a day of stops; rows land with correct seq/assignment; re-ingest idempotent; dashboard token reads `stops_public`; dispatcher token is the only writer. No TV change. `tsc --noEmit` clean. |
| **M7** | Multi-waypoint route proxy + live stops on the TV | Generalize `GET /api/route` to `vehicleId`-only + `legs[]`/`stopOffsets[]` (drop `destLat/destLng` + `positionKey`). `useLiveStops` hook. Replace `useRoute` inputs with `vehicleId` + `stopsKey`; re-fetch only on `stopsKey` change. | TV draws each active vehicle's multi-stop line from real seeded data, updating live as stop rows change; zero clicks; OSRM not hit on GPS pings. `tsc` clean. |
| **M8** | Traveled-vs-remaining greying + side rail + ETA | Add `@turf/nearest-point-on-line` + `@turf/line-slice`. Client-side split, clamped forward (out-and-back fix). Shared remaining/traveled FeatureCollection sources w/ data-driven paint. Emphasize next-stop marker; fade terminal stops. Build the fleet side rail (layout B); remove the map-click/`setDest`/crosshair/`DestPin` from `fleet-map.tsx`. | As the fake-GPS truck moves a seeded route the driven portion greys out and ETA-to-next updates; an out-and-back route greys the correct limb. `tsc` clean. |
| **M9** | Stop lifecycle + dispatcher mutations + cascades | Wire status transitions (arrived/completed/failed/skipped) + reassign/reorder/cancel through the RLS UPDATE path: `PATCH /api/stops/:id` (dispatcher) and the driver self-update policy from M6 (optional geofence auto-arrive w/ hysteresis). Confirm Realtime cascades. Add the second ingestion adapter **stub** mapping the client's export into the contract. | Marking the next stop complete on one client advances the TV route within one Realtime tick, no refetch storm. `tsc` clean. |

## Open questions (non-blocking)

1. **Data source:** what does the company's existing system actually expose (CSV, webhook, ERP API, nothing)? Decides only adapter #2's mapper — seam, schema, RLS, Realtime, TV are unaffected. Sets the field mapping and push-vs-pull.
2. **Deferred delivery timing:** confirmed out of scope to *orchestrate* (a return is just a later-ingested `dropoff`). Revisit only if the client needs the TV to model wash state.
3. **Geofenced auto-arrive vs explicit action:** the main optional-complexity lever in M9. Default: explicit for V1.
4. **Per-stop ETA windows:** deferred (ETA-to-next + total only) unless requested.

## Risks & mitigations

- **`nearestPointOnLine` under GPS jitter / route self-intersection (out-and-back is laundry's core shape):** clamp forward of the last completed stop's offset + forward-search window. OSRM `/match` behind the same proxy is the documented upgrade path.
- **Brief "routing…" gap when a stop set changes** (geometry fetched live, not stored): acceptable for monitoring; the next-stop panel still updates instantly from the stops channel (it doesn't depend on the line). Deliberate trade for a stateless API and zero cache-invalidation surface.
- **Realtime DELETE under default replica identity sends only the PK:** set `REPLICA IDENTITY FULL` on `stops` so `vehicle_id` is in the DELETE payload.
- **PII leakage:** keep all PII on `orders` (never published); drop `address` from `stops_public`; enforce in review for any new `stops` column.
- **Dispatcher write-auth:** shared-secret mint mirrors the dashboard code — env-only, never in a shipped image; a leaked secret = write access (same posture as the existing display code).
- **Multi-table ingest atomicity:** commit upsert + replace-set inside one rpc; handler stays thin. Bulk reassigns issue N lazy read-time OSRM calls — fine, off the GPS path.

## Constraints honored (the "Don'ts")

No Redis · no bespoke WebSocket (Supabase Realtime fan-out, reusing the M2 `postgres_changes` pattern) · no broad read-all RLS (dashboard claim-scoped policy + column-scoped `stops_public`, mirroring `0002`/`0003`) · OSRM stays internal behind the proxy · no public OSM tiles (no tile change) · stateless API (geometry fetched live, never stored) · no Supabase rearchitect · YAGNI/KISS/DRY throughout.
