# Bubble Box route sync — orders arrive by pull

**Date:** 2026-07-08 · **Status:** designed (two open items pending Dmytro)

## Why

M13 assumed Bubble Box's export carries orders with no van and no ordering, so
`/dispatch` existed to let a human assign them. Dmytro's answers (2026-07-08)
invalidate that picture entirely:

- Their backend already runs a **route optimization system**. Every rider gets
  a computed route per day and shift (`morning` / `evening`): ordered route
  points with planned arrival times, each point carrying its orders.
- Riders are assigned there (`pickupRider` / `deliveryRider` per order) — by
  their admins, fitting time slots. Nothing is unassigned, ever.
- Route points carry **live status** (`processing` / `done`): fulfillment is
  already tracked on their side, through the rider app.
- Changes (reassignment, time moves, cancellation) just reshape the routes;
  pulling returns the current truth. **They will not push** — we pull the same
  API their rider app uses (`GET /api/v2/rider-routes`, Hydra/API Platform).

So Fleetmap's order model becomes a **read-only mirror of Bubble Box's rider
routes**, refreshed by a small sync worker. Assignment, ordering, status, and
cancellation all belong upstream. `/dispatch` and the geofence auto-arrive
lose their reason to exist.

## Architecture

```
Bubble Box API                    Fleetmap
GET /api/v2/rider-routes  ──►  sync worker (workers/bubblebox-sync.ts)
  (per rider, today)              │  translate (lib/bubblebox/translate.ts)
                                  ▼
                           PUT /api/ingest/vehicle-routes   (dispatcher token)
                                  │  rpc sync_vehicle_routes — diff-apply
                                  ▼
                           orders + stops  ──► Supabase Realtime ──► TV
```

The worker is a long-running Node process (tsx), one more service in
`docker-compose.prod.yml` next to `osrm` — internal only, no exposed port. It
holds no secrets beyond the existing `DISPATCHER_INGEST_SECRET` (it mints a
dispatcher session exactly like `seed-stops` does; the Supabase secret key
stays off the VPS). Dev mode: run it locally against the dev server, like
`fake-gps`.

Loop, every `BB_SYNC_INTERVAL_MS` (default 60 000):

1. Ensure a dispatcher session (mint via `POST /api/dispatcher-session`;
   re-mint on 401 — tokens live ~1 h).
2. Read vehicles with a `rider_ref` (as dispatcher; select policy 0007).
3. Per vehicle: `GET` the rider's routes for today (Europe/Zurich day),
   morning + evening together (`dueDate[after]=<today>&dueDate[before]=<today>`).
4. Translate to the ingest payload (pure function, unit-tested).
5. `PUT /api/ingest/vehicle-routes` with the vehicle's full desired state.

Failures (BB down, one rider 404s) log and skip that tick — the TV keeps the
last good picture rather than going blank. The worker never crashes the loop.

## Translation — rider route → orders + stops

Source facts from Dmytro's example response (`rider-route 1.json`, checked in
as a test fixture):

- Route points are **not sorted** in the JSON (the example lists `endPoint`
  first) → sort by `arrivalTime` before assigning `seq`.
- Points of type `startPoint` / `endPoint` are the depot: no orders, no
  coordinates → **skipped**.
- A `collective` point holds several orders at one address → one stop **per
  order**, consecutive `seq`, same coordinates.
- Coordinates live on the nested order's `deliveryAddress.latitude/longitude`
  (strings — parse to float). For laundry, pickup and delivery share the
  customer address, so this serves both stop types.

| Fleetmap | Bubble Box |
|---|---|
| `orders.external_ref` | `order.orderCode` (e.g. `3AB-7RG`) |
| `orders.source` | `'bubblebox'` (fixed) |
| `orders.customer_name` | **not stored** (PII, see below) |
| `orders.scheduled_date` | route `dueDate` |
| `stops.stop_type` | `order.deliveryTypeOnRiderRouteDate`: `pickup`→`pickup`, `delivery`→`dropoff` |
| `stops.seq` | 1..N in `arrivalTime` order across the day (morning then evening) |
| `stops.lat` / `lng` | `order.deliveryAddress.latitude` / `.longitude` |
| `stops.address` | **not stored** (PII, see below) |
| `stops.eta_at` | route point `arrivalTime` |
| `stops.status` | point `status`: `done`→`completed`, `processing`→`planned`, unknown→`planned` + log |
| `stops.vehicle_id` | the vehicle whose `rider_ref` we pulled for |

An order appears on two routes across its life (pickup day, delivery day —
possibly different riders). Order upsert stays idempotent on
`(source, external_ref)`, so whichever vehicle syncs it first creates it and
the other reuses it.

## Sync semantics — vehicle-scoped mirror, diff-applied

The replace unit is **the vehicle's entire `bubblebox` stop set**, not a
single order (an order vanishing from a route can mean cancelled *or* moved —
mirror semantics make the distinction irrelevant). Each PUT carries today's
full picture for one vehicle; yesterday's stops disappear on the first sync of
a new day. Nothing renders past-day stops (History replays
`vehicle_positions`), so nothing is lost.

A new RPC `sync_vehicle_routes(p_vehicle_id, p_source, p_orders)` — security
invoker, dispatcher RLS is the boundary, like `ingest_stops`:

1. Upsert each order by `(source, external_ref)`.
2. Diff the vehicle's stops against the payload keyed on
   `(order_id, stop_type)`: update rows whose values changed, insert missing,
   delete rows keyed to `p_source` orders that are gone from the payload.
   **Blind delete+reinsert is not acceptable here**: a 60 s cadence would spam
   Realtime and — because `lib/use-fleet-routes.ts` refetches OSRM on stop-set
   change — re-route every vehicle every tick. Status-only changes must not
   alter row identity or coordinates.
3. Delete `p_source` orders left with zero stops (recreated idempotently if
   they reappear, e.g. on delivery day).

Scoping every delete to `p_source` keeps manual/seeded orders untouched, so
`seed-stops` and demo flows keep working. `stops_vehicle_seq_unique` is
`deferrable initially deferred`; the diff runs in one transaction, so seq
renumbering within a day is safe.

The existing `POST /api/ingest/routes` seam stays as-is for dev tooling; the
new `PUT /api/ingest/vehicle-routes` (same bearer auth, same thin-handler
shape: validate → RPC) is the sync's write path.

## Schema change (0009)

```sql
alter table vehicles add column if not exists rider_ref text unique;
```

`rider_ref` is the Bubble Box rider identity for the van — whatever the rider
API keys on (open item). Set per vehicle by hand at rollout; a van without one
is simply not synced.

## PII stance

The upstream payload is rich (customer name, phone, locker code, address,
products, prices). We store **none of it**: no `customer_name`, no `address`.
The TV renders neither (CLAUDE.md already flags `stops.address` riding
Realtime as a known exposure) — mirroring only `orderCode`, coordinates,
times, and status resolves that exposure by construction instead of by a
future migration.

## Retirements (phased)

- **Geofence auto-arrive** (`lib/geofence.ts`, called from
  `POST /api/location`): Bubble Box's point status is authoritative — a radius
  guess next to real fulfillment data is worse than useless (they'd fight).
  Remove the call + lib + tests once status sync is proven live; the driver
  stop-update RLS policies that existed for it go too.
- **`/dispatch`**: nothing left to assign or manage; every manual mutation
  would be overwritten by the next tick. Keep the page untouched but dormant
  through rollout as the break-glass tool, then delete `app/dispatch`,
  `components/dispatch/*`, `lib/dispatch/*`, and `PATCH /api/stops/:id`. The
  dispatcher *identity* and its RLS stay — they are the sync's auth.
- `scripts/seed-stops.ts` + adapter stub stay (dev/demo tooling).

## Config

```
BB_API_URL             # Bubble Box API base
BB_API_TOKEN           # auth — exact shape pending Dmytro (open item)
BB_SYNC_INTERVAL_MS    # default 60000
FLEETMAP_API_URL       # ingest target (http://app:3000 in the stack; dev: localhost)
DISPATCHER_INGEST_SECRET  # already exists
```

## Open items — blocked on Dmytro

1. **Auth + rider scoping for `/api/v2/rider-routes`.** The response contains
   no rider identifier, so the endpoint is presumably scoped by the
   authenticated caller. We need: how to authenticate, and how to fetch *a
   given rider's* routes (rider filter param? per-rider credentials? an admin
   token + rider param?). This determines what `rider_ref` holds.
2. **Status vocabulary + fulfillment time.** We've seen `processing`/`done`
   on route points; need the full enum, and where the "actual fulfillment
   time" (visible in their admin table) lives in the payload — it would give
   `stops.completed_at` a real value instead of null.

Neither blocks building the worker, translator, RPC, or endpoint — only the
final wiring of the fetch call and one status-map entry.

## Testing

- `lib/bubblebox/translate.ts` is a pure function; vitest fixtures from
  Dmytro's real example: sorting by arrival, depot skipping, collective
  expansion, string-coordinate parsing, status mapping, seq across
  morning+evening.
- Ingest validation for the new endpoint mirrors `lib/ingest-validate.ts`
  style + tests.
- RPC diff semantics verified manually against dev Supabase (same as
  `ingest_stops` was).
- E2E: run the worker locally against dev with Dmytro's credentials; verify a
  live BB test order lands, moves, completes, and cancels off the TV.

## Deliberately not now

- **Showing BB's planned time slots vs our live OSRM ETA** on the TV — the
  data will be there (`eta_at`); a display decision for later.
- **Street-only stop labels on the TV** — possible with a reduced-PII field if
  ops ever asks; today the TV renders no address, store nothing.
- **Pulling future days** — the mirror is today-only; the TV is a live board,
  not a planning tool.
- **Webhooks/push** — Dmytro was explicit: pull only. Revisit never, unless he
  offers.
