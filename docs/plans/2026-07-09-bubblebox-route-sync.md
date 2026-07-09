# Bubble Box Route Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pull worker that mirrors Bubble Box's rider routes into Fleetmap's orders/stops — assignment, ordering, and live stop status all come from their backend; the TV just reflects it.

**Architecture:** A long-running Node worker (`workers/bubblebox-sync.ts`) polls Bubble Box (structure every ~15 min, statuses every minute), translates via a pure function (`lib/bubblebox/translate.ts`), and PUTs each vehicle's full picture to a new `PUT /api/ingest/vehicle-routes`, backed by a diff-applying RPC (`sync_vehicle_routes`, migration 0009). Diff-apply is load-bearing: unchanged rows must emit no Realtime event and keep their ids (the TV's route cache keys on stop `id:seq:status` — `components/console/console-shell.tsx:43`).

**Tech Stack:** TypeScript, tsx worker, Next.js route handler, Supabase (Postgres RPC + RLS), vitest.

**Spec:** `docs/specs/2026-07-08-bubblebox-route-sync-design.md` — read it first.

**Out of scope (deliberately):**
- Wiring the real Bubble Box API — their dedicated endpoints don't exist yet. The worker's fetch layer reads a fixture file (`BB_FIXTURE_FILE`) until they ship; final wiring is a tiny follow-up (URLs, token call, field-name adjustments).
- Retiring the geofence and `/dispatch` — the spec phases those *after* the sync is proven live in prod. Separate plan.

## Global Constraints

- Package manager is **pnpm**. Import alias `@/*` → project root.
- Gate for every commit: `pnpm exec tsc --noEmit` AND `pnpm test` both clean.
- The Supabase **secret key never leaves `scripts/`** — the worker authenticates only via the dispatcher session (ingest secret) + publishable key.
- SQL: lowercase keywords, snake_case, `create ... if not exists`, policies/functions security-invoker unless stated; RLS is the boundary.
- Route handlers: validate input, `NextResponse.json` with explicit status codes (400 bad input / 401 no or invalid token / 500 db error), `export const runtime = "nodejs"`.
- Comments: match each file's existing density; only state constraints the code can't show. No narrative/"gotcha" comments.
- Store **no PII**: `customer_name` and `address` are never written by the sync path.

---

### Task 1: Translator — `lib/bubblebox/translate.ts`

Pure function: Bubble Box routes (+ optional fresher status entries) → one PUT payload per mapped vehicle. This is the only module that knows upstream field names.

**Files:**
- Create: `lib/bubblebox/translate.ts`
- Create: `lib/bubblebox/translate.test.ts`
- Create: `docs/bubblebox-rider-route-example.json` (copy of `tmp/rider-route 1.json` — Dmytro's raw rider-app example; `tmp/` is gitignored, this preserves provenance. Reference only, not imported.)

**Interfaces:**
- Consumes: nothing (pure, zero imports beyond types it defines).
- Produces (Tasks 3/5 rely on these exact names):
  - `type SyncStop = { stop_type: "pickup" | "dropoff"; seq: number; lat: number; lng: number; status: "planned" | "completed"; eta_at: string; completed_at: string | null }`
  - `type SyncOrder = { external_ref: string; scheduled_date: string; stops: SyncStop[] }`
  - `type SyncPayload = { vehicleId: string; orders: SyncOrder[] }`
  - `type BBRoute`, `type BBRoutePoint`, `type BBPointOrder`, `type BBStatusEntry` (shapes below)
  - `function buildSyncPayloads(routes: BBRoute[], statuses: BBStatusEntry[] | null, riderToVehicle: Map<string, string>): { payloads: SyncPayload[]; unmatchedRiders: string[] }`

- [ ] **Step 1: Copy the raw example for provenance**

```powershell
Copy-Item "tmp/rider-route 1.json" docs/bubblebox-rider-route-example.json
```

- [ ] **Step 2: Write the failing tests**

Create `lib/bubblebox/translate.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildSyncPayloads,
  type BBRoute,
  type BBStatusEntry,
} from "./translate"

// Data mirrors Dmytro's rider-app example (docs/bubblebox-rider-route-example.json),
// reshaped to the agreed contract (spec: "Upstream contract").
const point = (over: Partial<BBRoute["routePoints"][number]> = {}) => ({
  type: "pickup",
  status: "processing",
  arrivalTime: "2026-07-08T08:00:00+02:00",
  fulfilledAt: null,
  latitude: 47.3245229,
  longitude: 8.5065959,
  orders: [{ orderCode: "3AB-7RG", type: "pickup" as const }],
  ...over,
})

const route = (over: Partial<BBRoute> = {}): BBRoute => ({
  riderRef: "rider_zurichcity1@bb.ch",
  date: "2026-07-08",
  type: "morning",
  routePoints: [point()],
  ...over,
})

const MAP = new Map([["rider_zurichcity1@bb.ch", "veh-1"]])

describe("buildSyncPayloads", () => {
  it("maps a pickup point to a pickup stop with eta from arrivalTime", () => {
    const { payloads } = buildSyncPayloads([route()], null, MAP)
    expect(payloads).toEqual([
      {
        vehicleId: "veh-1",
        orders: [
          {
            external_ref: "3AB-7RG",
            scheduled_date: "2026-07-08",
            stops: [
              {
                stop_type: "pickup",
                seq: 1,
                lat: 47.3245229,
                lng: 8.5065959,
                status: "planned",
                eta_at: "2026-07-08T08:00:00+02:00",
                completed_at: null,
              },
            ],
          },
        ],
      },
    ])
  })

  it("maps delivery to dropoff and done to completed with fulfilledAt", () => {
    const r = route({
      routePoints: [
        point({
          type: "delivery",
          status: "done",
          fulfilledAt: "2026-07-08T08:03:12+02:00",
          orders: [{ orderCode: "3AB-7RG", type: "delivery" }],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.stop_type).toBe("dropoff")
    expect(stop.status).toBe("completed")
    expect(stop.completed_at).toBe("2026-07-08T08:03:12+02:00")
  })

  it("skips depot points and sorts the rest by arrivalTime", () => {
    // The real example lists endPoint FIRST — array order is untrustworthy.
    const r = route({
      routePoints: [
        point({ type: "endPoint", orders: [], arrivalTime: "2026-07-08T13:31:48+02:00" }),
        point({
          arrivalTime: "2026-07-08T09:00:00+02:00",
          orders: [{ orderCode: "BBB-222", type: "pickup" }],
        }),
        point({
          arrivalTime: "2026-07-08T08:00:00+02:00",
          orders: [{ orderCode: "AAA-111", type: "pickup" }],
        }),
        point({ type: "startPoint", orders: [], arrivalTime: "2026-07-08T05:49:28+02:00" }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const refs = payloads[0].orders.map((o) => o.external_ref)
    expect(refs).toEqual(["AAA-111", "BBB-222"])
    expect(payloads[0].orders[0].stops[0].seq).toBe(1)
    expect(payloads[0].orders[1].stops[0].seq).toBe(2)
  })

  it("expands a collective point into one stop per order, consecutive seqs, same coords", () => {
    const r = route({
      routePoints: [
        point({
          type: "collective",
          orders: [
            { orderCode: "3AB-7RG", type: "delivery" },
            { orderCode: "BG9-QCH", type: "delivery" },
          ],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders).toHaveLength(2)
    const stops = payloads[0].orders.map((o) => o.stops[0])
    expect(stops.map((s) => s.seq)).toEqual([1, 2])
    expect(stops[0].lat).toBe(stops[1].lat)
  })

  it("continues seq across morning and evening routes of the same rider", () => {
    const morning = route({
      routePoints: [point({ orders: [{ orderCode: "AAA-111", type: "pickup" }] })],
    })
    const evening = route({
      type: "evening",
      routePoints: [
        point({
          arrivalTime: "2026-07-08T18:00:00+02:00",
          orders: [{ orderCode: "BBB-222", type: "delivery" }],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([morning, evening], null, MAP)
    expect(payloads[0].orders.map((o) => o.stops[0].seq)).toEqual([1, 2])
  })

  it("merges pickup and delivery of the same order into one order with two stops", () => {
    const r = route({
      routePoints: [
        point({ orders: [{ orderCode: "SAME-DAY", type: "pickup" }] }),
        point({
          arrivalTime: "2026-07-08T11:00:00+02:00",
          orders: [{ orderCode: "SAME-DAY", type: "delivery" }],
        }),
      ],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders).toHaveLength(1)
    expect(payloads[0].orders[0].stops.map((s) => s.stop_type)).toEqual([
      "pickup",
      "dropoff",
    ])
  })

  it("applies status entries over the structure's point status", () => {
    const statuses: BBStatusEntry[] = [
      {
        orderCode: "3AB-7RG",
        type: "pickup",
        status: "done",
        fulfilledAt: "2026-07-08T08:10:00+02:00",
      },
    ]
    const { payloads } = buildSyncPayloads([route()], statuses, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.status).toBe("completed")
    expect(stop.completed_at).toBe("2026-07-08T08:10:00+02:00")
  })

  it("treats unknown upstream statuses as planned", () => {
    const r = route({ routePoints: [point({ status: "somethingNew" })] })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    expect(payloads[0].orders[0].stops[0].status).toBe("planned")
  })

  it("coerces string coordinates (their backend serializes decimals as strings)", () => {
    const r = route({
      routePoints: [point({ latitude: "47.32452290", longitude: "8.50659590" })],
    })
    const { payloads } = buildSyncPayloads([r], null, MAP)
    const stop = payloads[0].orders[0].stops[0]
    expect(stop.lat).toBe(47.3245229)
    expect(stop.lng).toBe(8.5065959)
  })

  it("reports unmatched riders and emits empty payloads for route-less vehicles", () => {
    const map = new Map([
      ["rider_zurichcity1@bb.ch", "veh-1"],
      ["rider_basel1@bb.ch", "veh-2"],
    ])
    const { payloads, unmatchedRiders } = buildSyncPayloads(
      [route(), route({ riderRef: "rider_unknown@bb.ch" })],
      null,
      map
    )
    expect(unmatchedRiders).toEqual(["rider_unknown@bb.ch"])
    const veh2 = payloads.find((p) => p.vehicleId === "veh-2")
    expect(veh2).toEqual({ vehicleId: "veh-2", orders: [] })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/bubblebox/translate.test.ts`
Expected: FAIL — `Cannot find module './translate'` (or equivalent resolve error).

- [ ] **Step 4: Write the implementation**

Create `lib/bubblebox/translate.ts`:

```ts
// Upstream shapes — the contract agreed with Bubble Box (spec: "Upstream
// contract"). Field names may shift when their dedicated API lands; this
// module is the only place that knows them.
export type BBPointOrder = {
  orderCode: string
  type: "pickup" | "delivery"
}

export type BBRoutePoint = {
  type: string // pickup | delivery | collective | startPoint | endPoint
  status: string // processing | done | … (full enum pending)
  arrivalTime: string
  fulfilledAt?: string | null
  // Their backend serializes decimals as strings ("47.32452290") — accept both.
  latitude: number | string
  longitude: number | string
  orders: BBPointOrder[]
}

export type BBRoute = {
  riderRef: string
  date: string
  type: "morning" | "evening"
  routePoints: BBRoutePoint[]
}

export type BBStatusEntry = {
  orderCode: string
  type: "pickup" | "delivery"
  status: string
  fulfilledAt?: string | null
}

export type SyncStop = {
  stop_type: "pickup" | "dropoff"
  seq: number
  lat: number
  lng: number
  status: "planned" | "completed"
  eta_at: string
  completed_at: string | null
}

export type SyncOrder = {
  external_ref: string
  scheduled_date: string
  stops: SyncStop[]
}

export type SyncPayload = { vehicleId: string; orders: SyncOrder[] }

const DEPOT_TYPES = new Set(["startPoint", "endPoint"])

// Anything not "done" (including statuses we haven't seen yet) renders as a
// pending stop — wrong-but-safe until the full upstream enum is known.
function mapStatus(upstream: string): "planned" | "completed" {
  return upstream === "done" ? "completed" : "planned"
}

function statusKey(orderCode: string, type: "pickup" | "delivery"): string {
  return `${orderCode}:${type}`
}

/**
 * Pure translation: rider routes (+ optional fresher status entries) → one
 * PUT payload per mapped vehicle. Every vehicle in riderToVehicle gets a
 * payload — an empty orders list is how a van's synced stops are cleared when
 * its routes vanish. Riders with no matching vehicle are reported, not
 * silently dropped.
 */
export function buildSyncPayloads(
  routes: BBRoute[],
  statuses: BBStatusEntry[] | null,
  riderToVehicle: Map<string, string>
): { payloads: SyncPayload[]; unmatchedRiders: string[] } {
  const overrides = new Map<string, BBStatusEntry>()
  for (const s of statuses ?? []) overrides.set(statusKey(s.orderCode, s.type), s)

  const routesByVehicle = new Map<string, BBRoute[]>()
  const unmatched = new Set<string>()
  for (const r of routes) {
    const vehicleId = riderToVehicle.get(r.riderRef)
    if (!vehicleId) {
      unmatched.add(r.riderRef)
      continue
    }
    const list = routesByVehicle.get(vehicleId) ?? []
    list.push(r)
    routesByVehicle.set(vehicleId, list)
  }

  const payloads: SyncPayload[] = []
  for (const vehicleId of riderToVehicle.values()) {
    const vehicleRoutes = routesByVehicle.get(vehicleId) ?? []

    const points = vehicleRoutes
      .flatMap((r) =>
        r.routePoints
          .filter((p) => !DEPOT_TYPES.has(p.type) && p.orders.length > 0)
          .map((p) => ({ point: p, date: r.date }))
      )
      .sort(
        (a, b) => Date.parse(a.point.arrivalTime) - Date.parse(b.point.arrivalTime)
      )

    const orders = new Map<string, SyncOrder>()
    let seq = 0
    for (const { point, date } of points) {
      for (const po of point.orders) {
        const override = overrides.get(statusKey(po.orderCode, po.type))
        const status = mapStatus(override?.status ?? point.status)
        const fulfilledAt = override?.fulfilledAt ?? point.fulfilledAt ?? null

        const order = orders.get(po.orderCode) ?? {
          external_ref: po.orderCode,
          scheduled_date: date,
          stops: [],
        }
        order.stops.push({
          stop_type: po.type === "delivery" ? "dropoff" : "pickup",
          seq: ++seq,
          lat: Number(point.latitude),
          lng: Number(point.longitude),
          status,
          eta_at: point.arrivalTime,
          completed_at: status === "completed" ? fulfilledAt : null,
        })
        orders.set(po.orderCode, order)
      }
    }

    payloads.push({ vehicleId, orders: [...orders.values()] })
  }

  return { payloads, unmatchedRiders: [...unmatched] }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/bubblebox/translate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Gate + commit**

```powershell
pnpm exec tsc --noEmit; pnpm test
git add lib/bubblebox docs/bubblebox-rider-route-example.json
git commit -m "feat(sync): Bubble Box route translator (pure, fixture-tested)"
```

---

### Task 2: Migration 0009 — `vehicles.rider_ref` + `sync_vehicle_routes` RPC

**Files:**
- Create: `supabase/migrations/0009_bubblebox_sync.sql`

**Interfaces:**
- Consumes: `orders` / `stops` tables + dispatcher RLS from `0004_orders_stops.sql`.
- Produces: `vehicles.rider_ref text unique` (read by Task 5's worker) and `sync_vehicle_routes(p_vehicle_id uuid, p_source text, p_orders jsonb)` (called by Task 4's endpoint). `p_orders` element shape = Task 1's `SyncOrder` (json).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_bubblebox_sync.sql`:

```sql
-- 0009_bubblebox_sync.sql — M15: Bubble Box route sync.
-- vehicles.rider_ref maps a van to its Bubble Box rider identity.
-- sync_vehicle_routes diff-applies one vehicle's full synced picture: with a
-- 60s poll, unchanged rows must emit no Realtime event and keep their ids
-- (the TV's route cache keys on stop id:seq:status).

alter table vehicles add column if not exists rider_ref text unique;

-- SECURITY INVOKER (default): the caller's RLS (dispatcher) is the boundary,
-- same as ingest_stops (0004).
create or replace function sync_vehicle_routes(
  p_vehicle_id uuid,
  p_source text,
  p_orders jsonb
)
  returns void
  language plpgsql
as $$
declare
  o jsonb;
  s jsonb;
  v_order_id uuid;
  v_stop_id uuid;
  v_keep uuid[] := '{}';
begin
  for o in select * from jsonb_array_elements(p_orders)
  loop
    insert into orders (external_ref, source, scheduled_date, status)
    values (
      o->>'external_ref',
      p_source,
      nullif(o->>'scheduled_date', '')::date,
      'assigned'
    )
    on conflict (source, external_ref) do update
      set scheduled_date = excluded.scheduled_date,
          updated_at     = now()
    returning id into v_order_id;

    for s in select * from jsonb_array_elements(o->'stops')
    loop
      select id into v_stop_id
        from stops
        where order_id = v_order_id and stop_type = s->>'stop_type';

      if v_stop_id is null then
        insert into stops
          (order_id, vehicle_id, stop_type, seq, lat, lng, status, eta_at, completed_at)
        values (
          v_order_id,
          p_vehicle_id,
          s->>'stop_type',
          (s->>'seq')::int,
          (s->>'lat')::double precision,
          (s->>'lng')::double precision,
          s->>'status',
          nullif(s->>'eta_at', '')::timestamptz,
          nullif(s->>'completed_at', '')::timestamptz
        )
        returning id into v_stop_id;
      else
        update stops set
          vehicle_id   = p_vehicle_id,
          seq          = (s->>'seq')::int,
          lat          = (s->>'lat')::double precision,
          lng          = (s->>'lng')::double precision,
          status       = s->>'status',
          eta_at       = nullif(s->>'eta_at', '')::timestamptz,
          completed_at = nullif(s->>'completed_at', '')::timestamptz
        where id = v_stop_id
          and (
            vehicle_id   is distinct from p_vehicle_id or
            seq          is distinct from (s->>'seq')::int or
            lat          is distinct from (s->>'lat')::double precision or
            lng          is distinct from (s->>'lng')::double precision or
            status       is distinct from s->>'status' or
            eta_at       is distinct from nullif(s->>'eta_at', '')::timestamptz or
            completed_at is distinct from nullif(s->>'completed_at', '')::timestamptz
          );
      end if;

      v_keep := v_keep || v_stop_id;
    end loop;
  end loop;

  -- Synced stops on this vehicle that vanished from the picture. An empty
  -- p_orders therefore clears the vehicle.
  delete from stops st
  using orders o
  where st.vehicle_id = p_vehicle_id
    and st.order_id = o.id
    and o.source = p_source
    and not (st.id = any (v_keep));

  -- Orders of this source left with no stops anywhere (cancelled, or between
  -- pickup day and delivery day) — recreated idempotently if they reappear.
  delete from orders o
  where o.source = p_source
    and not exists (select 1 from stops st where st.order_id = o.id);
end;
$$;

grant execute on function sync_vehicle_routes(uuid, text, jsonb) to authenticated;
```

- [ ] **Step 2: Apply it**

Run: `npx -y supabase db push`
Expected: `Applying migration 0009_bubblebox_sync.sql... Finished supabase db push.`
(Project is linked to ref `ewqxlsmzchrkvotjrlau`; if the link is missing it prompts for the DB password — ask the user rather than guessing.)

- [ ] **Step 3: Commit**

```powershell
git add supabase/migrations/0009_bubblebox_sync.sql
git commit -m "feat(sync): rider_ref mapping + diff-applying sync_vehicle_routes RPC (0009)"
```

---

### Task 3: Validation — `validateVehicleRoutes`

**Files:**
- Modify: `lib/ingest-validate.ts` (append; reuse the file's existing `isFiniteNumber`, `isUuid`, `isIsoDateString` helpers)
- Modify: `lib/ingest-validate.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: helpers already in `lib/ingest-validate.ts`.
- Produces: `function validateVehicleRoutes(body: unknown): { vehicle_id: string; orders: unknown[] } | { error: string }` — used by Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `lib/ingest-validate.test.ts` (match the file's existing test style — read it first):

```ts
describe("validateVehicleRoutes", () => {
  const VEH = "3f0e8f9a-1c2b-4d5e-8f9a-1c2b4d5e8f9a"
  const stop = (over: Record<string, unknown> = {}) => ({
    stop_type: "pickup",
    seq: 1,
    lat: 47.37,
    lng: 8.54,
    status: "planned",
    eta_at: "2026-07-08T08:00:00+02:00",
    ...over,
  })
  const body = (over: Record<string, unknown> = {}) => ({
    vehicle_id: VEH,
    orders: [
      { external_ref: "3AB-7RG", scheduled_date: "2026-07-08", stops: [stop()] },
    ],
    ...over,
  })

  it("accepts a valid payload", () => {
    expect(validateVehicleRoutes(body())).toEqual({
      vehicle_id: VEH,
      orders: body().orders,
    })
  })

  it("accepts an empty orders array (clears the vehicle)", () => {
    expect(validateVehicleRoutes({ vehicle_id: VEH, orders: [] })).toEqual({
      vehicle_id: VEH,
      orders: [],
    })
  })

  it("rejects a non-uuid vehicle_id", () => {
    expect(validateVehicleRoutes(body({ vehicle_id: "nope" }))).toEqual({
      error: "vehicle_id must be a uuid",
    })
  })

  it("rejects a stop with an unknown status", () => {
    const b = body()
    ;(b.orders[0].stops[0] as Record<string, unknown>).status = "delivering"
    expect(validateVehicleRoutes(b)).toEqual({
      error: "stop.status must be one of planned|arrived|completed|failed|skipped",
    })
  })

  it("rejects a stop with a malformed completed_at", () => {
    const b = body()
    ;(b.orders[0].stops[0] as Record<string, unknown>).completed_at = "yesterday"
    expect(validateVehicleRoutes(b)).toEqual({
      error: "stop.completed_at must be an ISO 8601 timestamp",
    })
  })

  it("rejects an order without stops", () => {
    expect(
      validateVehicleRoutes({
        vehicle_id: VEH,
        orders: [{ external_ref: "X", stops: [] }],
      })
    ).toEqual({ error: "order.stops must be a non-empty array" })
  })
})
```

Add `validateVehicleRoutes` to the file's import from `./ingest-validate`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run lib/ingest-validate.test.ts`
Expected: FAIL — `validateVehicleRoutes` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/ingest-validate.ts`:

```ts
const STOP_STATUSES = new Set(["planned", "arrived", "completed", "failed", "skipped"])

export function validateVehicleRoutes(body: unknown):
  | { vehicle_id: string; orders: unknown[] }
  | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const { vehicle_id, orders } = body as Record<string, unknown>
  if (!isUuid(vehicle_id)) {
    return { error: "vehicle_id must be a uuid" }
  }
  // Empty is valid: the sync clears a vehicle by sending zero orders.
  if (!Array.isArray(orders)) {
    return { error: "orders must be an array" }
  }
  for (const o of orders) {
    if (typeof o !== "object" || o === null) {
      return { error: "each order must be an object" }
    }
    const order = o as Record<string, unknown>
    if (typeof order.external_ref !== "string" || order.external_ref.length === 0) {
      return { error: "order.external_ref is required" }
    }
    if (
      order.scheduled_date != null &&
      order.scheduled_date !== "" &&
      !isIsoDateString(order.scheduled_date)
    ) {
      return { error: "order.scheduled_date must be an ISO 8601 date" }
    }
    if (!Array.isArray(order.stops) || order.stops.length === 0) {
      return { error: "order.stops must be a non-empty array" }
    }
    for (const s of order.stops) {
      if (typeof s !== "object" || s === null) {
        return { error: "each stop must be an object" }
      }
      const st = s as Record<string, unknown>
      if (st.stop_type !== "pickup" && st.stop_type !== "dropoff") {
        return { error: "stop.stop_type must be 'pickup' or 'dropoff'" }
      }
      if (!Number.isInteger(st.seq)) {
        return { error: "stop.seq must be an integer" }
      }
      if (!isFiniteNumber(st.lat) || st.lat < -90 || st.lat > 90) {
        return { error: "stop.lat must be a number in [-90, 90]" }
      }
      if (!isFiniteNumber(st.lng) || st.lng < -180 || st.lng > 180) {
        return { error: "stop.lng must be a number in [-180, 180]" }
      }
      if (typeof st.status !== "string" || !STOP_STATUSES.has(st.status)) {
        return { error: "stop.status must be one of planned|arrived|completed|failed|skipped" }
      }
      if (st.eta_at != null && st.eta_at !== "" && !isIsoDateString(st.eta_at)) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
      if (
        st.completed_at != null &&
        st.completed_at !== "" &&
        !isIsoDateString(st.completed_at)
      ) {
        return { error: "stop.completed_at must be an ISO 8601 timestamp" }
      }
    }
  }
  return { vehicle_id: vehicle_id as string, orders }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run lib/ingest-validate.test.ts`
Expected: PASS (existing + 6 new).

- [ ] **Step 5: Gate + commit**

```powershell
pnpm exec tsc --noEmit; pnpm test
git add lib/ingest-validate.ts lib/ingest-validate.test.ts
git commit -m "feat(sync): vehicle-routes payload validation"
```

---

### Task 4: Endpoint — `PUT /api/ingest/vehicle-routes`

Thin handler, same shape as `app/api/ingest/routes/route.ts`: validate → RPC → status codes. No handler unit tests (repo convention — handlers are exercised via validation tests + E2E).

**Files:**
- Create: `app/api/ingest/vehicle-routes/route.ts`

**Interfaces:**
- Consumes: `validateVehicleRoutes` (Task 3), `sync_vehicle_routes` RPC (Task 2), `bearerToken`/`isAuthError` from `@/lib/api-auth`, `createUserClient` from `@/lib/supabase/server`.
- Produces: `PUT /api/ingest/vehicle-routes` — body `{ vehicle_id, orders: SyncOrder[] }`, responses `200 {ok:true}` / `400` / `401` / `500`. Task 5 calls it.

- [ ] **Step 1: Write the handler**

Create `app/api/ingest/vehicle-routes/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"
import { validateVehicleRoutes } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// The sync worker's write path: one vehicle's full Bubble Box picture per
// call, diff-applied by the RPC. Source is fixed — manual/seeded orders are
// out of the replace scope by construction.
const SOURCE = "bubblebox"

export async function PUT(request: NextRequest) {
  const token = bearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 })
  }

  const parsed = validateVehicleRoutes(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { error } = await supabase.rpc("sync_vehicle_routes", {
    p_vehicle_id: parsed.vehicle_id,
    p_source: SOURCE,
    p_orders: parsed.orders,
  })
  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/vehicle-routes] rpc failed:", error)
    return NextResponse.json({ error: "sync failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 2: Gate + commit**

```powershell
pnpm exec tsc --noEmit; pnpm test
git add app/api/ingest/vehicle-routes/route.ts
git commit -m "feat(sync): PUT /api/ingest/vehicle-routes — diff-apply write path"
```

---

### Task 5: Worker — `workers/bubblebox-sync.ts`

Long-running loop. Structure fetch every `BB_STRUCTURE_INTERVAL_MS`, status fetch + PUT every `BB_SYNC_INTERVAL_MS`. Until Bubble Box ships their API, `BB_FIXTURE_FILE` feeds the structure fetch from a local JSON file (statuses come back `null` in fixture mode — the structure's own point statuses drive everything, which is exactly what re-reading a edited fixture exercises).

**Files:**
- Create: `workers/bubblebox-sync.ts`
- Modify: `package.json` (add script)
- Modify: `.env.example` (document the new vars)

**Interfaces:**
- Consumes: `buildSyncPayloads` + types (Task 1), `POST /api/dispatcher-session` (exists), `PUT /api/ingest/vehicle-routes` (Task 4), PostgREST read of `vehicles` (needs `rider_ref`, Task 2).
- Produces: nothing programmatic — a process. `pnpm bb-sync` runs it.

- [ ] **Step 1: Write the worker**

Create `workers/bubblebox-sync.ts`:

```ts
/**
 * Bubble Box route sync — mirrors their rider routes into orders/stops.
 *
 * Run with:  pnpm bb-sync   (the Next server must be reachable at
 *                            FLEETMAP_API_URL; dev default localhost:3000)
 *
 * Auth: dispatcher session only (ingest secret) — this process runs on the
 * VPS, so it never sees the Supabase secret key. Vehicles are read via
 * PostgREST as the dispatcher (select policy 0007).
 *
 * Until the dedicated Bubble Box API exists, BB_FIXTURE_FILE feeds the
 * structure fetch from a local JSON (BBRoute[]); statuses are null in
 * fixture mode.
 */
import { readFileSync } from "node:fs"
import {
  buildSyncPayloads,
  type BBRoute,
  type BBStatusEntry,
} from "../lib/bubblebox/translate"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const INGEST_SECRET = process.env.DISPATCHER_INGEST_SECRET
if (!SUPABASE_URL || !SUPABASE_KEY || !INGEST_SECRET) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, DISPATCHER_INGEST_SECRET."
  )
}

const API = process.env.FLEETMAP_API_URL ?? "http://localhost:3000"
const BB_API_URL = process.env.BB_API_URL
const FIXTURE = process.env.BB_FIXTURE_FILE
const SYNC_MS = Number(process.env.BB_SYNC_INTERVAL_MS ?? 60_000)
const STRUCTURE_MS = Number(process.env.BB_STRUCTURE_INTERVAL_MS ?? 900_000)

if (!BB_API_URL && !FIXTURE) {
  throw new Error("Set BB_API_URL (real feed) or BB_FIXTURE_FILE (dev).")
}

// Their day boundary is local Swiss time, not UTC.
function zurichToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(
    new Date()
  )
}

// --- Fleetmap side -----------------------------------------------------------

let dispatcherToken: string | null = null

async function mintDispatcherToken(): Promise<string> {
  const res = await fetch(`${API}/api/dispatcher-session`, {
    method: "POST",
    headers: { "x-ingest-secret": INGEST_SECRET! },
  })
  if (!res.ok) throw new Error(`dispatcher-session denied (${res.status})`)
  const { access_token } = (await res.json()) as { access_token: string }
  return access_token
}

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  dispatcherToken ??= await mintDispatcherToken()
  try {
    return await fn(dispatcherToken)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      dispatcherToken = await mintDispatcherToken()
      return await fn(dispatcherToken)
    }
    throw err
  }
}

class UnauthorizedError extends Error {}

async function fetchRiderMap(token: string): Promise<Map<string, string>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?select=id,rider_ref&rider_ref=not.is.null`,
    { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${token}` } }
  )
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`vehicles read failed (${res.status})`)
  const rows = (await res.json()) as { id: string; rider_ref: string }[]
  return new Map(rows.map((r) => [r.rider_ref, r.id]))
}

async function putVehicleRoutes(
  token: string,
  vehicleId: string,
  orders: unknown[]
): Promise<void> {
  const res = await fetch(`${API}/api/ingest/vehicle-routes`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ vehicle_id: vehicleId, orders }),
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) {
    throw new Error(`sync PUT failed (${res.status}): ${await res.text()}`)
  }
}

// --- Bubble Box side ---------------------------------------------------------
// Final wiring (URLs, token endpoint, field names) lands when their dedicated
// API ships — see the spec's open item. Fixture mode covers everything else.

async function fetchStructure(date: string): Promise<BBRoute[]> {
  if (FIXTURE) {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as BBRoute[]
  }
  throw new Error(`BB routes endpoint not wired yet (date=${date})`)
}

async function fetchStatuses(date: string): Promise<BBStatusEntry[] | null> {
  if (FIXTURE) return null
  throw new Error(`BB status endpoint not wired yet (date=${date})`)
}

// --- Loop --------------------------------------------------------------------

let structure: BBRoute[] = []
let structureAt = 0

async function tick(): Promise<void> {
  const today = zurichToday()
  if (Date.now() - structureAt >= STRUCTURE_MS || structure.length === 0) {
    structure = await fetchStructure(today)
    structureAt = Date.now()
  }
  const statuses = await fetchStatuses(today)

  const riderMap = await withToken(fetchRiderMap)
  const { payloads, unmatchedRiders } = buildSyncPayloads(
    structure,
    statuses,
    riderMap
  )
  if (unmatchedRiders.length > 0) {
    console.warn(`no vehicle for rider(s): ${unmatchedRiders.join(", ")}`)
  }

  for (const p of payloads) {
    await withToken((t) => putVehicleRoutes(t, p.vehicleId, p.orders))
  }
  const stops = payloads.reduce(
    (n, p) => n + p.orders.reduce((m, o) => m + o.stops.length, 0),
    0
  )
  console.log(
    `${new Date().toISOString()} synced ${payloads.length} vehicles / ${stops} stops`
  )
}

async function main(): Promise<void> {
  console.log(`bubblebox-sync: ${FIXTURE ? `fixture ${FIXTURE}` : BB_API_URL}`)
  for (;;) {
    try {
      await tick()
    } catch (err) {
      // Keep the last good picture on the TV; never crash the loop.
      console.error("tick failed:", err instanceof Error ? err.message : err)
    }
    await new Promise((r) => setTimeout(r, SYNC_MS))
  }
}

void main()
```

- [ ] **Step 2: Add the script**

In `package.json` scripts, after `"seed-stops"`:

```json
    "bb-sync": "tsx --env-file=.env workers/bubblebox-sync.ts",
```

- [ ] **Step 3: Document the env**

Append to `.env.example`:

```
# Bubble Box route sync (workers/bubblebox-sync.ts) — SERVER/WORKER-ONLY.
# BB_API_URL + BB_API_CREDENTIALS stay empty until their dedicated API ships;
# for dev, point BB_FIXTURE_FILE at a BBRoute[] JSON instead.
BB_API_URL=
BB_API_CREDENTIALS=
BB_SYNC_INTERVAL_MS=60000
BB_STRUCTURE_INTERVAL_MS=900000
FLEETMAP_API_URL=http://localhost:3000
BB_FIXTURE_FILE=
```

- [ ] **Step 4: Smoke-run the guard paths**

Run: `pnpm bb-sync` (with neither `BB_API_URL` nor `BB_FIXTURE_FILE` set in `.env`)
Expected: exits with `Set BB_API_URL (real feed) or BB_FIXTURE_FILE (dev).`

- [ ] **Step 5: Gate + commit**

```powershell
pnpm exec tsc --noEmit; pnpm test
git add workers/bubblebox-sync.ts package.json .env.example
git commit -m "feat(sync): bubblebox sync worker (fixture mode until their API ships)"
```

---

### Task 6: End-to-end verification against dev (fixture mode)

Proves the whole pipeline: fixture → translate → PUT → RPC diff → DB, including the two properties that matter — **stop ids stay stable across ticks** and **status flips are UPDATEs, not delete+reinsert**.

**Files:**
- Create: `workers/dev-fixture.json` (checked in — the dev driving data)

**Interfaces:**
- Consumes: everything from Tasks 1–5, a running dev server, the linked Supabase project, one provisioned van.

- [ ] **Step 1: Create the dev fixture**

Create `workers/dev-fixture.json`:

```json
[
  {
    "riderRef": "rider-dev@bb.ch",
    "date": "2026-07-09",
    "type": "morning",
    "routePoints": [
      {
        "type": "startPoint",
        "status": "done",
        "arrivalTime": "2026-07-09T05:49:28+02:00",
        "fulfilledAt": null,
        "latitude": 47.39,
        "longitude": 8.51,
        "orders": []
      },
      {
        "type": "pickup",
        "status": "processing",
        "arrivalTime": "2026-07-09T08:00:00+02:00",
        "fulfilledAt": null,
        "latitude": 47.3769,
        "longitude": 8.5417,
        "orders": [{ "orderCode": "DEV-001", "type": "pickup" }]
      },
      {
        "type": "collective",
        "status": "processing",
        "arrivalTime": "2026-07-09T09:00:00+02:00",
        "fulfilledAt": null,
        "latitude": 47.3245229,
        "longitude": 8.5065959,
        "orders": [
          { "orderCode": "DEV-002", "type": "delivery" },
          { "orderCode": "DEV-003", "type": "delivery" }
        ]
      }
    ]
  }
]
```

- [ ] **Step 2: Map a van to the fixture rider**

In the Supabase SQL editor (dev project), pick one existing vehicle and set its `rider_ref`:

```sql
update vehicles
set rider_ref = 'rider-dev@bb.ch'
where id = (select id from vehicles order by created_at limit 1)
returning id, label, rider_ref;
```

Note the returned `id` — used below.

- [ ] **Step 3: Run the pipeline**

Terminal 1: `pnpm dev`
Terminal 2: set in `.env`: `BB_FIXTURE_FILE=workers/dev-fixture.json`, then `pnpm bb-sync`
Expected log: `synced 1 vehicles / 3 stops` (startPoint skipped; collective expanded to 2).

- [ ] **Step 4: Verify rows + capture stop ids**

SQL editor:

```sql
select s.id, o.external_ref, s.stop_type, s.seq, s.status, s.address
from stops s join orders o on o.id = s.order_id
where o.source = 'bubblebox'
order by s.seq;
```

Expected: 3 rows — `DEV-001 pickup seq 1 planned`, `DEV-002 dropoff seq 2 planned`, `DEV-003 dropoff seq 3 planned`; `address` is null on all (PII stance). Copy the three `id` values.

- [ ] **Step 5: Prove diff-apply (id stability + status flip)**

Edit `workers/dev-fixture.json`: on the pickup point, set `"status": "done"` and `"fulfilledAt": "2026-07-09T08:05:00+02:00"`. Wait one tick (≤ 60s), re-run the Step 4 query.
Expected: same three `id` values; `DEV-001` now `completed`; `completed_at` set. If the ids changed, the RPC is reinserting — that's a failure, fix before proceeding.

- [ ] **Step 6: Prove removal + clearing**

Remove the collective point from the fixture, wait one tick, re-run the query.
Expected: only `DEV-001` remains; `DEV-002`/`DEV-003` orders are gone (GC'd). Then replace the whole file content with `[]`, wait one tick: zero `bubblebox` rows remain.

- [ ] **Step 7: Eyeball the TV**

Restore the fixture to Step 1's content. Open `/dashboard` (display code from `.env`), find the mapped van.
Expected: its 3 stops render with route line; after re-doing the Step 5 status flip, the pickup pin fades and next-stop moves — without a page reload.

- [ ] **Step 8: Reset + commit**

SQL editor cleanup: `update vehicles set rider_ref = null where rider_ref = 'rider-dev@bb.ch'; delete from orders where source = 'bubblebox';`
Unset `BB_FIXTURE_FILE` in `.env`.

```powershell
git add workers/dev-fixture.json
git commit -m "test(sync): dev fixture for fixture-mode E2E"
```

---

### Task 7: Prod wiring — Dockerfile stage + compose service

**Files:**
- Modify: `Dockerfile` (insert the `sync` stage **between** the `build` and `runner` stages — the last stage must remain `runner`, because the compose `app` service builds without an explicit `target`)
- Modify: `docker-compose.prod.yml` (add the `sync` service)
- Modify: `docs/deployment.md` (one short subsection)

**Interfaces:**
- Consumes: the worker (Task 5) and its env vars.
- Produces: a `sync` service in the prod stack.

- [ ] **Step 1: Add the Dockerfile stage**

Insert into `Dockerfile` after the `build` stage and before `runner`:

```dockerfile
# --- sync: Bubble Box route sync worker (tsx; internal only, no port) ---
FROM base AS sync
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY workers ./workers
COPY lib/bubblebox ./lib/bubblebox
CMD ["pnpm", "exec", "tsx", "workers/bubblebox-sync.ts"]
```

- [ ] **Step 2: Add the compose service**

In `docker-compose.prod.yml`, after the `app` service:

```yaml
  sync:
    build:
      context: .
      target: sync
    restart: unless-stopped
    env_file: .env       # BB_* + DISPATCHER_INGEST_SECRET + NEXT_PUBLIC_SUPABASE_*
    environment:
      FLEETMAP_API_URL: http://app:3000   # reach the app by service name
    depends_on:
      - app
```

- [ ] **Step 3: Verify the stack definition and the build graph**

```powershell
docker compose -f docker-compose.prod.yml config --quiet
pnpm build
```

Expected: compose exits 0 silently; `pnpm build` completes (confirms the new route handler compiles into the standalone server and the worker doesn't break the Next build).

- [ ] **Step 4: Document deployment**

In `docs/deployment.md`, add under the services description:

```markdown
### Route sync worker

`sync` (in `docker-compose.prod.yml`) polls the Bubble Box API and mirrors
rider routes into orders/stops via `PUT /api/ingest/vehicle-routes`. It needs
`BB_API_URL` + `BB_API_CREDENTIALS` in `/opt/fleetmap/.env` (empty = the
service exits on boot; that's fine until Bubble Box ships their API). Map each
van once: `update vehicles set rider_ref = '<their rider id>' where id = …`.
```

- [ ] **Step 5: Gate + commit**

```powershell
pnpm exec tsc --noEmit; pnpm test
git add Dockerfile docker-compose.prod.yml docs/deployment.md
git commit -m "feat(sync): sync worker joins the prod stack"
```

---

### Task 8: Docs — CLAUDE.md, spec status, old contract banner

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/specs/2026-07-08-bubblebox-route-sync-design.md` (status line only)
- Modify: `docs/order-ingestion-api.md` (banner only)

- [ ] **Step 1: CLAUDE.md**

Layout section — add (keep alphabetical-ish grouping with the ingest lines):

```
app/api/ingest/vehicle-routes/route.ts   PUT — sync worker write path (diff-apply RPC)
workers/bubblebox-sync.ts   Bubble Box pull worker (structure 15min / status 60s)
lib/bubblebox/translate.ts  pure rider-route → orders/stops translation (tested)
```

Milestones — mark the new one done and update the tail:

```
- [x] **M15 — Bubble Box route sync:** pull worker mirrors their rider routes (assignment, order, status all upstream); `vehicles.rider_ref` mapping (0009) + diff-applying `sync_vehicle_routes` RPC + `PUT /api/ingest/vehicle-routes`; fixture mode until their dedicated API ships. Spec: `docs/specs/2026-07-08-bubblebox-route-sync-design.md`.
- Later: wire the real Bubble Box endpoints (token/routes/statuses) when Dmytro ships; then retire geofence + /dispatch per the spec. ← next
```

Commands — add `pnpm bb-sync` with a one-line note (fixture or real feed).

Conventions — in the `/dispatch` bullet, append one sentence: orders now arrive assigned via the sync; `/dispatch` is dormant break-glass until the sync is proven, then it gets deleted (spec, "Retirements").

- [ ] **Step 2: Spec status**

In the spec header, change `**Status:** designed (two open items pending Dmytro)` to `**Status:** implemented in fixture mode — real endpoint wiring pending Bubble Box`.

- [ ] **Step 3: Banner on the old contract**

At the top of `docs/order-ingestion-api.md`, after the title:

```markdown
> **Superseded for Bubble Box (2026-07-09):** orders now arrive by pull — see
> `docs/specs/2026-07-08-bubblebox-route-sync-design.md`. This document remains
> the contract for the manual/dev ingestion seam (`POST /api/ingest/routes`).
```

- [ ] **Step 4: Gate + commit**

```powershell
pnpm exec tsc --noEmit; pnpm test
git add CLAUDE.md docs/specs/2026-07-08-bubblebox-route-sync-design.md docs/order-ingestion-api.md
git commit -m "docs: M15 route sync — layout, milestone, superseded push contract"
```
