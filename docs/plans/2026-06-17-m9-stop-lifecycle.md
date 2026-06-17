# M9 — Stop Lifecycle: Geofence Auto-Arrive + Dispatcher Mutations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give stops a real status-change mechanism — the truck's live position auto-advances its next stop (`planned→arrived→completed`), and a dispatcher can mutate stops via `PATCH /api/stops/:id` — so the M8 TV (greying, fade, next-stop, stops-left) is driven by reality instead of `fake-gps`'s simulation.

**Architecture:** Geofence runs **server-side inside `POST /api/location`** (which already runs as the driver via RLS): after saving a position, it reads the driver's next stop, computes straight-line distance, and applies at most one forward transition with two-radius hysteresis. A new driver `SELECT` RLS policy (migration `0005`) lets the handler read those stops. `PATCH /api/stops/[id]` provides the dispatcher override path. `fake-gps` reverts to just driving — the server geofence now advances its stops.

**Tech Stack:** Next.js App Router (route handlers, Node runtime) + TypeScript, Supabase (RLS-as-boundary, Realtime), OSRM behind the existing proxy. Package manager **pnpm**.

## Global Constraints

- TypeScript throughout; the gate is **`pnpm exec tsc --noEmit`** — must be clean **except** the pre-existing `components/ui/calendar.tsx` shadcn error (ignore only that one). **There is no test suite** (per `CLAUDE.md`); verification is `tsc` + the runnable acceptance shown per task.
- `pnpm lint` is **red repo-wide** on a pre-existing `react-hooks/refs` rule; do **not** try to make `pnpm lint` exit 0. For any file you create/modify, confirm `npx eslint <file>` introduces no NEW errors.
- **RLS is the security boundary.** Handlers run as the caller via `createUserClient(token)`; `.eq()` filters are for clarity, not security. Every new policy is explicit and scoped.
- **The secret key is dev-only** (`scripts/` only). The geofence runs as the *driver* (not the secret). Never import the secret key into a request handler.
- Route handlers validate input and return `NextResponse.json` with explicit status codes: `400` bad input, `401` no/invalid token, `404` not found, `409` conflict, `500` db error.
- SQL: lowercase keywords, snake_case, `create policy` named in plain English (mirror `0004`).
- Import alias `@/*` → project root. Source spec: `docs/specs/2026-06-17-m9-stop-lifecycle-design.md` (read it for rationale).
- Match each edited file's existing comment density; no gratuitous rationale comments in code.
- Work on branch `m9-stop-lifecycle`. Commit per task; end every commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

> **Prereqs to run end-to-end acceptance:** `docker compose up -d osrm`; `pnpm dev`; apply migrations (`supabase db push` or the project's migration path); `pnpm seed-stops`; the dashboard display code entered on the TV; `pnpm fake-gps` to move the seeded vehicle. The DB must have migration `0005` applied before geofence acceptance.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `supabase/migrations/0005_driver_read_stops.sql` | driver `SELECT` policy on own-vehicle stops | **create** |
| `lib/geofence.ts` | pure `haversineMeters` + `decideTransition`; `applyGeofence(supabase, vehicleId, lat, lng)` | **create** |
| `app/api/location/route.ts` | call `applyGeofence` after the position write (never fails the post) | **modify** |
| `app/api/stops/[id]/route.ts` | `PATCH` — dispatcher status/reassign/reorder/cancel | **create** |
| `scripts/fake-gps.ts` | remove plan-001's `completeStop` simulation; just drive | **modify** |
| `scripts/adapters/csv-to-stops.example.ts` | adapter-2 **stub**: pure CSV-row → ingest-contract mapper | **create** |
| `.env.example` | document `GEOFENCE_ARRIVE_RADIUS_M` / `GEOFENCE_DEPART_RADIUS_M` | **modify** |
| `CLAUDE.md` | Layout entries + M9 milestone done + fake-gps line | **modify** |

---

## Task 1: Migration `0005` — driver `SELECT` policy on stops

**Files:**
- Create: `supabase/migrations/0005_driver_read_stops.sql`

**Interfaces:**
- Produces: a driver `SELECT` RLS policy on `stops` scoped to `vehicle_id = own assigned vehicle`. Task 2's geofence read depends on it.

**Context:** `0004` shipped `"drivers can update their own vehicle stops"` (UPDATE) and `"dashboard role can read all stops"` (SELECT), but **no driver SELECT** policy — so a driver token cannot read `stops` today. The geofence in Task 2 runs as the driver and must read the next stop. The policy mirrors the existing driver UPDATE one exactly.

- [ ] **Step 1: Create the migration**

```sql
-- 0005_driver_read_stops.sql — M9: driver read surface for the geofence.
-- POST /api/location runs as the driver and must read its vehicle's next stop to
-- evaluate the geofence. 0004 added a driver UPDATE policy on stops but no SELECT;
-- add the matching SELECT, scoped to the driver's own assigned vehicle.
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

- [ ] **Step 2: Apply the migration**

Run: `supabase db push` (or the project's documented apply path).
Expected: `0005` applies cleanly; `stops` now has four policies (dispatcher all, dashboard select, driver update, driver select).

- [ ] **Step 3: Verify the policy exists**

Run (psql or Supabase SQL editor):
`select policyname, cmd from pg_policies where tablename = 'stops' order by policyname;`
Expected rows include `drivers can read their own vehicle stops | SELECT`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0005_driver_read_stops.sql
git commit -m "feat(m9): driver SELECT policy on stops (geofence read surface)"
```

---

## Task 2: Geofence module + wire into `POST /api/location`

**Files:**
- Create: `lib/geofence.ts`
- Modify: `app/api/location/route.ts`

**Interfaces:**
- Consumes: `createUserClient` (returns a supabase-js client); the `stops` table (`id, lat, lng, status, seq`, status enum `planned|arrived|completed|failed|skipped`); env `GEOFENCE_ARRIVE_RADIUS_M` (default 60), `GEOFENCE_DEPART_RADIUS_M` (default 120).
- Produces:
  - `haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number`
  - `decideTransition(status: string, distanceM: number): "arrived" | "completed" | null`
  - `applyGeofence(supabase: SupabaseClient, vehicleId: string, lat: number, lng: number): Promise<void>`

- [ ] **Step 1: Create `lib/geofence.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js"

// Two-radius hysteresis: arrive on entering the inner radius, complete on leaving
// the outer one after arriving. Outer > inner so boundary jitter can't flap.
const ARRIVE_RADIUS_M = Number(process.env.GEOFENCE_ARRIVE_RADIUS_M ?? "60")
const DEPART_RADIUS_M = Number(process.env.GEOFENCE_DEPART_RADIUS_M ?? "120")

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const la1 = toRad(aLat)
  const la2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// The single forward transition (if any) for the next stop given its distance.
export function decideTransition(
  status: string,
  distanceM: number
): "arrived" | "completed" | null {
  if (status === "planned" && distanceM <= ARRIVE_RADIUS_M) return "arrived"
  if (status === "arrived" && distanceM > DEPART_RADIUS_M) return "completed"
  return null
}

/**
 * Read the driver's next stop (lowest-seq, planned|arrived) and apply at most one
 * forward transition based on the live position. Runs as the driver: the driver
 * SELECT/UPDATE RLS policies (0004/0005) are the boundary. Caller must guard this
 * so a geofence failure never fails the position write.
 */
export async function applyGeofence(
  supabase: SupabaseClient,
  vehicleId: string,
  lat: number,
  lng: number
): Promise<void> {
  const { data, error } = await supabase
    .from("stops")
    .select("id, lat, lng, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
    .limit(1)
  if (error) throw error
  const stop = (data ?? [])[0] as
    | { id: string; lat: number; lng: number; status: string }
    | undefined
  if (!stop) return

  const distance = haversineMeters(lat, lng, stop.lat, stop.lng)
  const next = decideTransition(stop.status, distance)
  if (!next) return

  const patch =
    next === "completed"
      ? { status: next, completed_at: new Date().toISOString() }
      : { status: next }
  const { error: updateError } = await supabase
    .from("stops")
    .update(patch)
    .eq("id", stop.id)
  if (updateError) throw updateError
}
```

- [ ] **Step 2: Typecheck the new module**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `components/ui/calendar.tsx` error. `lib/geofence.ts` clean.

- [ ] **Step 3: Wire it into `POST /api/location`**

In `app/api/location/route.ts`, add the import at the top (with the other imports):

```ts
import { applyGeofence } from "@/lib/geofence"
```

Then, between the existing step 6 (vehicle `update`) success and the final `return`, insert a geofence step. The final part of `POST` becomes:

```ts
  if (updateError) {
    console.error("[/api/location] vehicle update failed:", updateError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }

  // 7. Geofence: advance the next stop from this position. Best-effort — a
  // geofence failure must never fail the position write.
  try {
    await applyGeofence(supabase, vehicle.id, lat, lng)
  } catch (err) {
    console.error("[/api/location] geofence failed:", err)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

(Do not change steps 1–6. `vehicle.id`, `lat`, `lng`, and `supabase` are already in scope.)

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error.

- [ ] **Step 5: End-to-end acceptance (needs 0005 applied + OSRM + dev server + seeded stops)**

Start `docker compose up -d osrm`, `pnpm dev`, ensure `0005` is applied and stops seeded, enter the display code on the TV, then `pnpm fake-gps`.
Expected: as the fake truck passes each stop, the TV shows that stop go **arrived → completed** within a Realtime tick; the grey route advances, the completed stop fades and drops, the next stop is emphasized, "stops-left" decrements. In the DB, `stops.status`/`completed_at` change **even though `fake-gps` no longer writes them** (it still does in this task — fully verified after Task 4; for now confirm the server transitions happen at all).
If the truck never advances a stop, check `GEOFENCE_ARRIVE_RADIUS_M` and that `0005` is applied (a driver SELECT failure is swallowed and logged as `[/api/location] geofence failed`).

- [ ] **Step 6: Commit**

```bash
git add lib/geofence.ts app/api/location/route.ts
git commit -m "feat(m9): server-side geofence auto-arrive in POST /api/location"
```

---

## Task 3: `PATCH /api/stops/[id]` — dispatcher mutations

**Files:**
- Create: `app/api/stops/[id]/route.ts`

**Interfaces:**
- Consumes: a dispatcher Bearer token (minted via `POST /api/dispatcher-session`); `createUserClient`; the `stops` table dispatcher RLS UPDATE policy (`0004`).
- Produces: `PATCH /api/stops/:id` accepting `{ status?, vehicle_id?, seq? }`, returning `{ ok: true }` on success.

**Context:** Mirrors the existing handler conventions (`app/api/ingest/stops/route.ts`, `app/api/location/route.ts`): Bearer-token auth, `validate()` returning `{...}|{error}`, `createUserClient`, `isAuthError` → 401. The dispatcher RLS policy is the write boundary. Next 16 route params are async (`params: Promise<{ id }>`).

- [ ] **Step 1: Create the handler**

```ts
import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

const STATUSES = ["arrived", "completed", "failed", "skipped"] as const
type Status = (typeof STATUSES)[number]

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}

// Validate the mutation body into a stops patch. At least one mutable field.
function validate(
  body: unknown
): { patch: Record<string, unknown> } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !STATUSES.includes(b.status as Status)) {
      return { error: `status must be one of ${STATUSES.join(", ")}` }
    }
    patch.status = b.status
    if (b.status === "completed") patch.completed_at = new Date().toISOString()
  }

  if (b.vehicle_id !== undefined) {
    if (
      b.vehicle_id !== null &&
      (typeof b.vehicle_id !== "string" || !UUID_RE.test(b.vehicle_id))
    ) {
      return { error: "vehicle_id must be a UUID or null" }
    }
    patch.vehicle_id = b.vehicle_id
  }

  if (b.seq !== undefined) {
    if (!Number.isInteger(b.seq)) {
      return { error: "seq must be an integer" }
    }
    patch.seq = b.seq
  }

  if (Object.keys(patch).length === 0) {
    return { error: "no mutable fields (status, vehicle_id, seq)" }
  }
  return { patch }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid stop id" }, { status: 400 })
  }

  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 })
  }

  const parsed = validate(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { data, error } = await supabase
    .from("stops")
    .update(parsed.patch)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    // 23505 = unique_violation on (vehicle_id, seq): a reorder into an occupied slot.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "seq already taken for this vehicle" },
        { status: 409 }
      )
    }
    console.error("[/api/stops/:id] update failed:", error)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!data) {
    // No row updated: nonexistent id, or RLS hid it (not a dispatcher).
    return NextResponse.json({ error: "no such stop" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error.

- [ ] **Step 3: Acceptance (dev server + dispatcher token)**

With `pnpm dev` running and stops seeded, mint a dispatcher token the way `scripts/seed-stops.ts` does (`POST /api/dispatcher-session` with `x-ingest-secret`), grab a seeded stop id, then:
- `PATCH /api/stops/<id>` with `{"status":"completed"}` → `200`; the TV drops that stop within a Realtime tick.
- `PATCH /api/stops/<id>` with `{"status":"nope"}` → `400`.
- `PATCH /api/stops/<id>` with no `Authorization` header → `401`.
- `PATCH /api/stops/<random-uuid>` with `{"status":"failed"}` → `404`.
If you cannot mint a token, STOP and report acceptance UNVERIFIED (the code typechecks); do not claim the endpoint works.

- [ ] **Step 4: Commit**

```bash
git add app/api/stops/[id]/route.ts
git commit -m "feat(m9): PATCH /api/stops/:id — dispatcher status/reassign/reorder"
```

---

## Task 4: Revert `fake-gps`'s simulated completion

**Files:**
- Modify: `scripts/fake-gps.ts`

**Interfaces:**
- Produces: a `fake-gps` that drives the seeded OSRM route and POSTs positions, but writes **no** stop status (the server geofence from Task 2 does that now).

**Context:** Plan 001 added `completeStop()` + per-stop offset tracking so the script could simulate completion. With the server geofence live, that's redundant and would double-write. Remove it; the script reverts to "drive + POST." Current relevant code: `getActiveStops` returns `Stop[]` (id/lng/lat); `fetchDrivenRoute` returns `{ coords, stopOffsets }`; `completeStop` writes status; the drive loop calls `completeStop(stops[0])` then completes stops as `dist` crosses each offset.

- [ ] **Step 1: Replace `getActiveStops` to return plain coordinates**

Replace the `getActiveStops` function (currently returning `Stop[]`) with:

```ts
async function getActiveStops(
  admin: SupabaseClient,
  vehicleId: string
): Promise<Pt[]> {
  const { data, error } = await admin
    .from("stops")
    .select("lng, lat, seq, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
  if (error) throw error
  return ((data ?? []) as { lng: number; lat: number }[]).map((s) => [
    s.lng,
    s.lat,
  ])
}
```

- [ ] **Step 2: Replace `fetchDrivenRoute` (+ its type) with a coords-only fetch**

Delete the `type DrivenRoute = …` line and the `fetchDrivenRoute` function, and the `type Stop = …` line (no longer used). Add a coords-only fetcher:

```ts
async function fetchRouteCoords(stops: Pt[]): Promise<Pt[] | null> {
  const coords = stops.map(([lng, lat]) => `${lng},${lat}`).join(";")
  const u = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const json = (await res.json()) as {
      code: string
      routes?: { geometry: { coordinates: Pt[] } }[]
    }
    const route = json.routes?.[0]
    if (json.code !== "Ok" || !route) return null
    return route.geometry.coordinates
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Delete `completeStop`**

Remove the entire `completeStop` function (the `async function completeStop(...) { ... }` block).

- [ ] **Step 4: Simplify the drive loop (remove all completion)**

In `main`, replace the geometry-fetch + drive-loop block (the part from `const route = stops.length > 0 ? await fetchDrivenRoute(stops) : null` through the end of the `for (;;)` loop) with:

```ts
  const coords = stops.length > 0 ? await fetchRouteCoords(stops) : null
  if (!coords || coords.length < 2) {
    const why =
      stops.length === 0
        ? "no active stops (run `pnpm seed-stops` first)"
        : "OSRM route unavailable (is `docker compose up -d osrm` running?)"
    console.log(`${why} — falling back to random wander.`)
    await randomWalk(post)
    return
  }

  const path = buildPath(coords)
  const step = SPEED_MPS * (TICK_MS / 1000)
  console.log(
    `driving ${(path.total / 1000).toFixed(1)} km through ${stops.length} ` +
      `stops at ${SPEED_MPS} m/s; the server geofence advances stops as the ` +
      `truck passes them. (Ctrl+C to stop)`
  )

  let dist = 0
  for (;;) {
    const { pos, heading } = pointAt(path, dist)
    const atEnd = dist >= path.total
    await post(pos[1], pos[0], heading, atEnd ? 0 : SPEED_MPS)
    if (atEnd) {
      await sleep(TICK_MS)
      continue
    }
    dist = Math.min(dist + step, path.total)
    await sleep(TICK_MS)
  }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error. Confirm no leftover references to `completeStop`, `DrivenRoute`, `Stop`, `fetchDrivenRoute`, or `stopOffsets`:
Run: `grep -nE "completeStop|DrivenRoute|fetchDrivenRoute|stopOffsets|type Stop" scripts/fake-gps.ts`
Expected: no matches.

- [ ] **Step 6: End-to-end acceptance**

Re-run the Task 2 acceptance. Now confirm the stops advance on the TV **and** `fake-gps`'s logs contain **no** `stop … -> completed` lines (it no longer writes status) — the server geofence is solely responsible.

- [ ] **Step 7: Commit**

```bash
git add scripts/fake-gps.ts
git commit -m "refactor(m9): fake-gps drives only; server geofence advances stops"
```

---

## Task 5: Adapter-2 stub (CSV → ingest contract)

**Files:**
- Create: `scripts/adapters/csv-to-stops.example.ts`

**Interfaces:**
- Produces: a pure `mapCsvRowsToIngestPayload(rows)` demonstrating the export → `POST /api/ingest/stops` contract mapping. Not wired to `package.json`; not executed.

**Context:** The monitoring-pivot doc's adapter #2 ("a thin mapper from the client's export into the same contract"). The real source is still unknown (open-question #1), so this is a **stub** proving the seam: a typed mapper from a generic CSV row shape into the exact ingest contract. It must typecheck but stays inert (no top-level execution, no env).

- [ ] **Step 1: Create the stub**

```ts
/**
 * Adapter #2 (STUB) — example only, not wired into package.json.
 *
 * The client's real export format is still unknown (monitoring-pivot design,
 * open-question #1). This shows the *shape* of mapping an external export into
 * the `POST /api/ingest/stops` contract — proving the ingestion seam holds
 * without building a live feed. Swap `CsvRow` + the mapping for the real source
 * when known; the contract below does not change.
 */

// One flat row as a generic CSV/ERP export might provide it.
type CsvRow = {
  order_ref: string
  customer: string
  pickup_lat: string
  pickup_lng: string
  dropoff_lat: string
  dropoff_lng: string
  vehicle_id: string
  pickup_seq: string
  dropoff_seq: string
}

// The exact POST /api/ingest/stops contract (see app/api/ingest/stops/route.ts).
type IngestPayload = {
  orders: {
    external_ref: string
    source: string
    customer_name?: string
    stops: {
      stop_type: "pickup" | "dropoff"
      vehicle_id: string
      seq: number
      lat: number
      lng: number
    }[]
  }[]
}

export function mapCsvRowsToIngestPayload(rows: CsvRow[]): IngestPayload {
  return {
    orders: rows.map((r) => ({
      external_ref: r.order_ref,
      source: "csv",
      customer_name: r.customer,
      stops: [
        {
          stop_type: "pickup",
          vehicle_id: r.vehicle_id,
          seq: Number(r.pickup_seq),
          lat: Number(r.pickup_lat),
          lng: Number(r.pickup_lng),
        },
        {
          stop_type: "dropoff",
          vehicle_id: r.vehicle_id,
          seq: Number(r.dropoff_seq),
          lat: Number(r.dropoff_lat),
          lng: Number(r.dropoff_lng),
        },
      ],
    })),
  }
}

// Usage (illustrative — do not run): POST the payload to /api/ingest/stops with a
// dispatcher Bearer token, exactly as scripts/seed-stops.ts does.
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error. `scripts/adapters/csv-to-stops.example.ts` clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/adapters/csv-to-stops.example.ts
git commit -m "docs(m9): adapter-2 stub — CSV export → ingest contract mapper"
```

---

## Task 6: Docs — `.env.example` + `CLAUDE.md`

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the geofence env vars**

In `.env.example`, add (near the other server-side vars; keep names only, no secrets):

```
# Geofence auto-arrive radii (metres). Outer must exceed inner (hysteresis).
GEOFENCE_ARRIVE_RADIUS_M=60
GEOFENCE_DEPART_RADIUS_M=120
```

- [ ] **Step 2: Update `CLAUDE.md` Layout**

In the `## Layout` fenced block, add these lines (group with the related entries):

```
app/api/stops/[id]/route.ts          PATCH stop — dispatcher mutation (status/reassign/reorder)
lib/geofence.ts             server-side geofence auto-arrive (POST /api/location)
```

And update the existing `scripts/fake-gps.ts` line to drop the "marks each stop completed" note (it no longer does — the server geofence does):

```
scripts/fake-gps.ts         dev-only fake GPS poster (drives the seeded route)
```

- [ ] **Step 3: Mark M9 done in Milestones**

In `## Milestones`, immediately after the `- [x] **M8 …**` line, insert:

```
- [x] **M9 — stop lifecycle:** server-side geofence auto-arrive in POST /api/location (two-radius hysteresis, next-stop-by-seq) + driver SELECT RLS (0005) + PATCH /api/stops/:id (dispatcher reassign/reorder/cancel/status); fake-gps drives only; adapter-2 stub.
```

Leave the `- Later:` line, but remove `geofenced "arrived" events` from it (now shipped) so it reads:
```
- Later: orders/deliveries model, auto-assigned dropoffs + status, route replay. ← next
```

- [ ] **Step 4: Typecheck (docs don't affect it, but confirm the tree is clean)**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error.

- [ ] **Step 5: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs(m9): record geofence + PATCH endpoint; mark M9 done"
```

---

## Self-review

- **Spec coverage:** geofence auto-arrive (server-side, two-radius, next-stop-by-seq) → Task 2 ✓; driver SELECT RLS → Task 1 ✓; `PATCH /api/stops/:id` (status/reassign/reorder, completed_at, 409 on seq clash) → Task 3 ✓; fake-gps simulation revert → Task 4 ✓; adapter-2 stub → Task 5 ✓; env defaults + docs → Task 6 ✓. Out-of-scope per spec (order.status cascade, skip-ahead, driver UI, driver-policy column-restriction) → not built ✓.
- **Dependency order:** Task 1 (migration) must land + be **applied** before Task 2's acceptance (geofence read needs the driver SELECT policy). Task 4's "no completion lines" acceptance depends on Task 2 being live. Tasks 3 and 5 are independent and may run in any order.
- **Placeholder scan:** every code step shows complete code; no TBD/TODO; acceptance commands are concrete. The adapter is an intentional, documented stub (not a placeholder).
- **Type/name consistency:** `haversineMeters`/`decideTransition`/`applyGeofence` (Task 2) match their call in `route.ts`; `SupabaseClient` imported as a type; `mapCsvRowsToIngestPayload` self-contained; the ingest stub's contract matches `app/api/ingest/stops/route.ts`'s validated fields (`external_ref`, `source`, `customer_name`, `stops[stop_type, vehicle_id, seq, lat, lng]`).
- **Constraints honored:** no schema beyond one additive policy; geofence runs as the driver (no secret in a handler); never fails the position write; explicit status codes; RLS-as-boundary throughout; YAGNI (no order cascade / skip-ahead / driver UI).
- **Known limitation (documented in the spec):** a stop whose `ARRIVE_RADIUS_M` is never entered (truck drives straight past) stays `planned`; recovery is a dispatcher `PATCH`. Acceptable for V1.
