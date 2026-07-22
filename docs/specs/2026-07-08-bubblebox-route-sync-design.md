# Bubble Box route sync — orders arrive by pull

**Date:** 2026-07-08 · **Status:** wired against the shipped staging API (2026-07-22) — see "Shipped API" for the contract as built

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
  pulling returns the current truth. **They will not push** — we pull.
  Dmytro is building a **dedicated Fleetmap API** (plus a token endpoint with
  app-scoped rights) rather than exposing the rider-app API directly; his
  rider-app example (`GET /api/v2/rider-routes`, Hydra/API Platform) defines
  the semantics, and our proposed response shape is below.

So Fleetmap's order model becomes a **read-only mirror of Bubble Box's rider
routes**, refreshed by a small sync worker. Assignment, ordering, status, and
cancellation all belong upstream. `/dispatch` and the geofence auto-arrive
lose their reason to exist.

## Architecture

```
Bubble Box API                    Fleetmap
GET <fleetmap routes API> ──►  sync worker (workers/bubblebox-sync.ts)
  (all riders, today)             │  translate (lib/bubblebox/translate.ts)
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

The fetch is two-tier (agreed with Dmytro 2026-07-09, prompted by his
response-size concern): their backend **forbids changing a started route** —
additions only land in the not-yet-started route (morning locks when it
starts; new orders go to evening) — so route *structure* is fetched rarely,
while point *status* (the thing that changes all day and drives the TV's
stop fade / next-stop / ETA) is polled every minute from a slim dedicated
endpoint.

Loop:

1. Ensure both tokens: a Bubble Box token (their token endpoint, app-scoped)
   and a dispatcher session (`POST /api/dispatcher-session`); re-mint either
   on 401.
2. Read vehicles with a `rider_ref` (as dispatcher; select policy 0007) to
   build the rider→vehicle map.
3. Every `BB_STRUCTURE_INTERVAL_MS` (default 15 min, and at startup): `GET`
   today's full routes (Europe/Zurich day) — all riders, morning + evening,
   started or not; each route carries its rider identifier. Held in worker
   memory as the current structure. Routes whose rider matches no vehicle
   (and vice versa) are logged, skipped.
4. Every `BB_SYNC_INTERVAL_MS` (default 60 000): `GET` the slim status
   endpoint, merge statuses into the in-memory structure.
5. Translate to the ingest payload (pure function, unit-tested) and
   `PUT /api/ingest/vehicle-routes` per vehicle with its full desired state —
   every tick. The RPC's diff-apply makes status-only ticks nearly free on
   the Realtime side; our ingest surface needs no second endpoint.

Failures (BB down, one rider 404s) log and skip that tick — the TV keeps the
last good picture rather than going blank. The worker never crashes the loop.

## Upstream contract (proposed 2026-07-08; two-tier split agreed 2026-07-09)

Since the API is being built for us, we ask for the minimum and nothing else —
in particular **no customer PII, no products, no prices** (we neither store
nor display them, and it keeps his payload small). Three endpoints: token,
full routes (fetched rarely), statuses (polled per minute):

```
POST <token endpoint>                      → { token }   (app-scoped)

GET  <status endpoint>?date=2026-07-08     → today's point statuses, flat
[
  { "orderCode": "3AB-7RG", "type": "pickup | delivery",
    "status": "done", "fulfilledAt": "2026-07-08T08:03:12+02:00 | null" }
]

GET  <routes endpoint>?date=2026-07-08     → all riders' routes for that day
                                             (started or not)
[
  {
    "riderRef": "<stable rider identifier — uuid or account>",
    "date": "2026-07-08",
    "type": "morning",
    "routePoints": [
      {
        "type": "pickup | delivery | collective | startPoint | endPoint",
        "status": "processing | done | …(full enum)",
        "arrivalTime": "2026-07-08T08:00:00+02:00",
        "fulfilledAt": "2026-07-08T08:03:12+02:00 | null",
        "latitude": 47.3245229,
        "longitude": 8.5065959,
        "orders": [
          { "orderCode": "3AB-7RG", "type": "pickup | delivery" }
        ]
      }
    ]
  }
]
```

Deltas vs the rider-app example, and why: coordinates directly on the route
point (saves nesting whole orders just for the address); a `riderRef` per
route (the rider-app response has none — it's implicitly scoped); order
entries reduced to `orderCode` + that order's pickup/delivery role at this
point (`deliveryTypeOnRiderRouteDate` in the example); `fulfilledAt` exposed
(their admin UI has it; the example payload doesn't); one call returning all
riders for a date (no per-rider enumeration on our side). If any of this is
inconvenient for him, the example's shape works too — the worker just does
more joining.

## Shipped API (2026-07-22) — the contract as built

Dmytro shipped the dedicated fleet API on staging (`https://upgrade.bubblebox.ch`)
close to the proposed shape: plain JSON array, coordinates on the point, orders
slimmed to `{orderCode, type}`, **no customer PII in the payload at all**.
Sample response: `docs/bubblebox-fleet-routes-example.json`. Deltas vs the
proposal, all reflected in `lib/bubblebox/translate.ts`:

```
POST /api/v2/fleet/authentication-token   { username, password }
  → { data: { loginToken }, status }     RS256 JWT, 24 h expiry,
                                          role ROLE_FLEET_OPERATOR
GET  /api/v2/fleet/rider-routes?dueDate[notEarlier]=D&dueDate[notLater]=D
  header accessToken: <loginToken>        (custom header, not Authorization)
  → [ { rider: { id, fullName }, dueDate, type, routePoints: [...] } ]
```

- `riderRef` became `rider: { id, fullName }` — `vehicles.rider_ref` holds the
  numeric id as text.
- `date` became `dueDate`, a datetime at Zurich midnight; the date part is the
  business day.
- `fulfilledAt` became `actualFulfillmentTime`, and it is the completion
  signal: the status enum (`processing | done | picked_up |
  ready_for_delivery | loaded_for_delivery`) is the *order* lifecycle
  projected onto points — `picked_up` on a fulfilled pickup point, pipeline
  states on unfulfilled delivery points. A stop is completed iff
  `actualFulfillmentTime` is set (verified across a year of staging data:
  exactly the fulfilled points carry it).
- A few points arrive with null coordinates (geocoding gaps upstream) —
  translated stops are dropped and reported, never sent to ingest.
- `startPoint` carries no `arrivalTime` (depots are filtered anyway).
- **No slim status endpoint yet** — the two-tier split collapsed to polling
  the full endpoint every tick (a year of routes is ~330 KB / 0.6 s, one day
  a few KB, so size is a non-issue). The `BBStatusEntry` override path stays
  in the translator for the `isShort`/status tier Dmytro floated.
- Omitting the date params also means "today", but resolved server-side; the
  worker passes both bounds explicitly with its Europe/Zurich date. Invalid
  intervals are silently coerced to today on their side.
- Upstream fetch/mapping failures silently omit that route from the response
  (their choice, may become error-stub objects later) — indistinguishable
  from a cleared route for us, converging on the next good tick.

## Translation — rider route → orders + stops

Semantics established by Dmytro's rider-app example response
(`rider-route 1.json`, checked in as a test fixture); the dedicated API keeps
these, whatever the final field names:

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
BB_API_URL                # Bubble Box API base (staging: https://upgrade.bubblebox.ch)
BB_API_USERNAME           # fleet user for their token endpoint
BB_API_PASSWORD           #   (24 h token, re-minted on 401)
BB_SYNC_INTERVAL_MS       # poll cadence, default 60000
FLEETMAP_API_URL          # ingest target (http://app:3000 in the stack; dev: localhost)
DISPATCHER_INGEST_SECRET  # already exists
```

`BB_STRUCTURE_INTERVAL_MS` is gone — with no slim status endpoint the full
fetch happens every tick; it returns with the status tier.

## Open item — resolved 2026-07-22

The dedicated API shipped on staging; everything previously unknown (URLs,
field names, token mechanics, status enum, rider identifier) is documented in
"Shipped API" above and wired in the worker/translator. Confirmed by Dmytro
2026-07-22: `actualFulfillmentTime` is set by the rider's "done" button (the
intended completion signal), `rider.id` is an immutable DB id, and the
null-coordinate points were staging test-data artifacts. Still open upstream:
the slim status tier (`isShort`), error-stub objects for skipped routes, prod
deployment timing/credentials, and whether rider id numbers match between
their staging and prod DBs.

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
