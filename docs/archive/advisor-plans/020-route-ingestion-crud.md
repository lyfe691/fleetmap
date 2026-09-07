# Route Ingestion CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the client a dedicated `/api/ingest/routes` endpoint with full create / update / delete of delivery routes, reusing the existing orders/stops model.

**Architecture:** A "route" is the existing `orders` row + its `stops` (keyed by `(source, external_ref)`). Create/update already exist as the `ingest_stops` RPC — we re-path that endpoint to `/api/ingest/routes` and rename its body key `orders` → `routes`. The only new behaviour is **delete**, which already works at the DB layer (cascade + dispatcher RLS) and just needs an HTTP route. No database migration. The live dashboard read path is untouched.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript, Supabase (`createUserClient` + RLS), vitest.

**Spec:** `docs/specs/2026-06-29-route-ingestion-crud-design.md`

## Global Constraints

- **No DB migration.** The RPC (`ingest_stops`) and the `orders`/`stops` tables are unchanged; this is an HTTP-layer rename + one new endpoint.
- **Auth = RLS.** Both endpoints run as the dispatcher via `createUserClient(token)`; `role='dispatcher'` RLS is the write boundary. A Bearer token is required.
- **Status codes:** `400` bad input · `401` missing/invalid token · `404` no such route · `500` db error · `200` success. (Mirrors the existing handlers.)
- **Canonical body is UUID-based.** `vehicle_id` / `area_id` in stops are UUIDs; resolving the client's own van/city codes is the adapter's job (out of scope here).
- **Gate before "done":** `pnpm exec tsc --noEmit` and `pnpm test` must pass. Because this adds/removes route files, the final task also runs `pnpm build` to confirm the route manifest.
- **Import alias** `@/*` → repo root. Route handlers `export const runtime = "nodejs"`.

---

## File Structure

- `lib/ingest-validate.ts` — body validation. `validate()` (rename `orders`→`routes`) + new `validateDeleteParams()`.
- `lib/ingest-validate.test.ts` — vitest unit tests for both.
- `app/api/ingest/routes/route.ts` — **new** (replaces `app/api/ingest/stops/route.ts`); POST create/update.
- `app/api/ingest/routes/[external_ref]/route.ts` — **new**; DELETE.
- `app/api/ingest/stops/` — **removed**.
- `scripts/seed-stops.ts`, `scripts/adapters/csv-to-stops.example.ts` — callers updated to the new path + body key.
- `CLAUDE.md` — layout + ingestion convention note.

---

## Task 1: Re-path create/update to `/api/ingest/routes` (body key `orders` → `routes`)

**Files:**
- Modify: `lib/ingest-validate.ts`
- Test: `lib/ingest-validate.test.ts`
- Create: `app/api/ingest/routes/route.ts`
- Remove: `app/api/ingest/stops/route.ts`
- Modify: `scripts/seed-stops.ts:118`, `scripts/seed-stops.ts:124`, `scripts/seed-stops.ts:11`
- Modify: `scripts/adapters/csv-to-stops.example.ts`
- Modify: `CLAUDE.md` (layout line for the ingest endpoint)

**Interfaces:**
- Produces: `validate(body: unknown): { routes: unknown[] } | { error: string }` (was `{ orders }`).
- Consumes: existing `ingest_stops` RPC with param `p_orders jsonb` (unchanged — the handler passes `parsed.routes` to it).

- [ ] **Step 1: Update the validation tests to the `routes` vocabulary (failing first)**

Replace the entire contents of `lib/ingest-validate.test.ts` with:

```typescript
import { describe, it, expect } from "vitest"
import { validate } from "@/lib/ingest-validate"

const VALID_STOP = {
  stop_type: "dropoff",
  seq: 1,
  lat: 47.3769,
  lng: 8.5417,
}

const VALID_ROUTE = {
  external_ref: "RT-001",
  stops: [VALID_STOP],
}

const VALID_BODY = { routes: [VALID_ROUTE] }

describe("validate", () => {
  it("valid payload → { routes }", () => {
    const result = validate(VALID_BODY)
    expect("routes" in result).toBe(true)
    if ("routes" in result) {
      expect(result.routes).toEqual(VALID_BODY.routes)
    }
  })

  it("null body → error", () => {
    expect("error" in validate(null)).toBe(true)
  })

  it("string body → error", () => {
    expect("error" in validate("not-an-object")).toBe(true)
  })

  it("empty routes array → error", () => {
    const result = validate({ routes: [] })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/non-empty/)
  })

  it("missing routes key → error", () => {
    expect("error" in validate({})).toBe(true)
  })

  it("missing external_ref → error", () => {
    const result = validate({ routes: [{ stops: [VALID_STOP] }] })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/external_ref/)
  })

  it("empty external_ref → error", () => {
    const result = validate({ routes: [{ external_ref: "", stops: [VALID_STOP] }] })
    expect("error" in result).toBe(true)
  })

  it("bad stop_type → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, stop_type: "delivery" }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/stop_type/)
  })

  it("non-integer seq → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, seq: 1.5 }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/seq/)
  })

  it("lat out of range (< -90) → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, lat: -91 }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/lat/)
  })

  it("lat out of range (> 90) → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, lat: 91 }] }],
    })
    expect("error" in result).toBe(true)
  })

  it("lng out of range (> 180) → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, lng: 181 }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/lng/)
  })

  it("non-UUID vehicle_id → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, vehicle_id: "not-a-uuid" }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/vehicle_id/)
  })

  it("valid UUID vehicle_id → ok", () => {
    const result = validate({
      routes: [
        {
          external_ref: "RT-001",
          stops: [{ ...VALID_STOP, vehicle_id: "550e8400-e29b-41d4-a716-446655440000" }],
        },
      ],
    })
    expect("routes" in result).toBe(true)
  })

  it("null vehicle_id (optional) → ok", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, vehicle_id: null }] }],
    })
    expect("routes" in result).toBe(true)
  })

  it("non-ISO eta_at → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, eta_at: "not-a-date" }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/eta_at/)
  })

  it("valid ISO eta_at → ok", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, eta_at: "2026-06-22T10:00:00Z" }] }],
    })
    expect("routes" in result).toBe(true)
  })

  it("pickup stop_type → ok", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, stop_type: "pickup" }] }],
    })
    expect("routes" in result).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm test`
Expected: FAIL — `validate` still returns `{ orders }`, so `"routes" in result` is false.

- [ ] **Step 3: Update `validate()` to the `routes` vocabulary**

In `lib/ingest-validate.ts`, replace the `validate` function (lines 16–79, from `export function validate` to its closing `}`) with this. The helpers above it (`isFiniteNumber`, `UUID_RE`, `isUuid`, `isIsoDateString`) are unchanged:

```typescript
export function validate(body: unknown): { routes: unknown[] } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const routes = (body as Record<string, unknown>).routes
  if (!Array.isArray(routes) || routes.length === 0) {
    return { error: "routes must be a non-empty array" }
  }
  for (const r of routes) {
    if (typeof r !== "object" || r === null) {
      return { error: "each route must be an object" }
    }
    const route = r as Record<string, unknown>
    if (typeof route.external_ref !== "string" || route.external_ref.length === 0) {
      return { error: "route.external_ref is required" }
    }
    if (!Array.isArray(route.stops) || route.stops.length === 0) {
      return { error: "route.stops must be a non-empty array" }
    }
    if (
      route.scheduled_date != null &&
      route.scheduled_date !== "" &&
      !isIsoDateString(route.scheduled_date)
    ) {
      return { error: "route.scheduled_date must be an ISO 8601 date" }
    }
    for (const s of route.stops) {
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
      if (st.vehicle_id != null && st.vehicle_id !== "" && !isUuid(st.vehicle_id)) {
        return { error: "stop.vehicle_id must be a UUID" }
      }
      if (st.area_id != null && st.area_id !== "" && !isUuid(st.area_id)) {
        return { error: "stop.area_id must be a UUID" }
      }
      if (st.eta_at != null && st.eta_at !== "" && !isIsoDateString(st.eta_at)) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
    }
  }
  return { routes }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm test`
Expected: PASS (all `validate` cases green).

- [ ] **Step 5: Create the new POST handler at the routes path**

Create `app/api/ingest/routes/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"
import { validate } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
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

  const parsed = validate(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  // The RPC upserts each route as an orders row + replace-sets its stops.
  const supabase = createUserClient(token)
  const { error } = await supabase.rpc("ingest_stops", {
    p_orders: parsed.routes,
  })
  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/routes] rpc failed:", error)
    return NextResponse.json({ error: "ingest failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 6: Delete the old endpoint**

Run: `git rm app/api/ingest/stops/route.ts`
(The directory becomes empty and drops out of git. The DELETE handler in Task 2 lives under the new `routes/` path, so nothing else needs the old folder.)

- [ ] **Step 7: Update `scripts/seed-stops.ts` to the new path + body key**

In `scripts/seed-stops.ts`:

Change the doc-comment line (currently `*   3. POST every city's orders+stops to /api/ingest/stops, exercising the real`):
```
 *   3. POST every city's orders+stops to /api/ingest/routes, exercising the real
```

Change the fetch URL (currently `const res = await fetch(`${API}/api/ingest/stops`, {`):
```typescript
  const res = await fetch(`${API}/api/ingest/routes`, {
```

Change the body (currently `body: JSON.stringify({ orders }),`):
```typescript
    body: JSON.stringify({ routes: orders }),
```

- [ ] **Step 8: Update the CSV adapter stub to the new contract**

Replace the contents of `scripts/adapters/csv-to-stops.example.ts` with:

```typescript
/**
 * Adapter #2 (STUB) — example only, not wired into package.json.
 *
 * The client's real export format is still unknown. This shows the *shape* of
 * mapping an external export into the `POST /api/ingest/routes` contract —
 * proving the ingestion seam holds without building a live feed. Swap `CsvRow`
 * + the mapping for the real source when known; the contract below does not change.
 */

// One flat row as a generic CSV/ERP export might provide it.
type CsvRow = {
  route_ref: string
  customer: string
  pickup_lat: string
  pickup_lng: string
  dropoff_lat: string
  dropoff_lng: string
  vehicle_id: string
  pickup_seq: string
  dropoff_seq: string
}

// The exact POST /api/ingest/routes contract (see app/api/ingest/routes/route.ts).
type IngestPayload = {
  routes: {
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
    routes: rows.map((r) => ({
      external_ref: r.route_ref,
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

// Usage (illustrative — do not run): POST the payload to /api/ingest/routes with a
// dispatcher Bearer token, exactly as scripts/seed-stops.ts does.
```

- [ ] **Step 9: Update `CLAUDE.md` layout line**

In `CLAUDE.md`, find the layout line:
```
app/api/ingest/stops/route.ts        ingestion seam — orders/stops (POST)
```
Replace it with:
```
app/api/ingest/routes/route.ts       ingestion seam — routes (POST create/update)
```
Then run `Grep` for `ingest/stops` across `CLAUDE.md` and update any other prose reference to `ingest/routes` (leave files under `plans/`, `docs/plans/`, and `docs/specs/` other than this plan untouched — they are point-in-time history).

- [ ] **Step 10: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no lingering `parsed.orders` reference).

Run: `pnpm test`
Expected: PASS.

```bash
git add lib/ingest-validate.ts lib/ingest-validate.test.ts app/api/ingest scripts/seed-stops.ts scripts/adapters/csv-to-stops.example.ts CLAUDE.md
git commit -m "feat(ingest): re-path create/update to /api/ingest/routes (routes body key)"
```

---

## Task 2: Add `DELETE /api/ingest/routes/[external_ref]`

**Files:**
- Modify: `lib/ingest-validate.ts` (add `validateDeleteParams`)
- Test: `lib/ingest-validate.test.ts` (add a `validateDeleteParams` describe block)
- Create: `app/api/ingest/routes/[external_ref]/route.ts`
- Modify: `CLAUDE.md` (add the DELETE layout line + a CRUD note)

**Interfaces:**
- Consumes: `validateDeleteParams` (defined here); the `orders` table delete via `createUserClient`.
- Produces: `validateDeleteParams(input: { external_ref: unknown; source: unknown }): { external_ref: string; source: string } | { error: string }`.

- [ ] **Step 1: Write the failing `validateDeleteParams` tests**

Append this `describe` block to the end of `lib/ingest-validate.test.ts`, and add `validateDeleteParams` to the import on line 2 so it reads `import { validate, validateDeleteParams } from "@/lib/ingest-validate"`:

```typescript
describe("validateDeleteParams", () => {
  it("valid external_ref, no source → defaults source to 'manual'", () => {
    const result = validateDeleteParams({ external_ref: "RT-001", source: null })
    expect("error" in result).toBe(false)
    if (!("error" in result)) {
      expect(result.external_ref).toBe("RT-001")
      expect(result.source).toBe("manual")
    }
  })

  it("explicit source → used as-is", () => {
    const result = validateDeleteParams({ external_ref: "RT-001", source: "client-x" })
    if (!("error" in result)) expect(result.source).toBe("client-x")
    else throw new Error("expected ok")
  })

  it("empty string source → defaults to 'manual'", () => {
    const result = validateDeleteParams({ external_ref: "RT-001", source: "" })
    if (!("error" in result)) expect(result.source).toBe("manual")
    else throw new Error("expected ok")
  })

  it("missing external_ref → error", () => {
    const result = validateDeleteParams({ external_ref: "", source: null })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/external_ref/)
  })

  it("non-string external_ref → error", () => {
    const result = validateDeleteParams({ external_ref: 123, source: null })
    expect("error" in result).toBe(true)
  })

  it("non-string source → error", () => {
    const result = validateDeleteParams({ external_ref: "RT-001", source: 5 })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/source/)
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `pnpm test`
Expected: FAIL — `validateDeleteParams` is not exported (import error / not a function).

- [ ] **Step 3: Implement `validateDeleteParams`**

Append to the end of `lib/ingest-validate.ts`:

```typescript
// Validate the DELETE route params. external_ref is required (path segment);
// source is optional and defaults to 'manual' to match the ingest default.
export function validateDeleteParams(input: {
  external_ref: unknown
  source: unknown
}): { external_ref: string; source: string } | { error: string } {
  const { external_ref, source } = input
  if (typeof external_ref !== "string" || external_ref.length === 0) {
    return { error: "external_ref is required" }
  }
  if (source != null && source !== "" && typeof source !== "string") {
    return { error: "source must be a string" }
  }
  const src = typeof source === "string" && source.length > 0 ? source : "manual"
  return { external_ref, source: src }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

Run: `pnpm test`
Expected: PASS (all `validate` and `validateDeleteParams` cases green).

- [ ] **Step 5: Create the DELETE handler**

Create `app/api/ingest/routes/[external_ref]/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"
import { validateDeleteParams } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// Delete a route (the orders row by source+external_ref). Stops cascade off the
// map (stops.order_id is ON DELETE CASCADE); Realtime DELETE events evict the
// markers on the TV.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ external_ref: string }> }
) {
  const { external_ref } = await params
  const source = request.nextUrl.searchParams.get("source")

  const parsed = validateDeleteParams({ external_ref, source })
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const token = bearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { data, error } = await supabase
    .from("orders")
    .delete()
    .eq("source", parsed.source)
    .eq("external_ref", parsed.external_ref)
    .select("id")
    .maybeSingle()

  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/routes/:external_ref] delete failed:", error)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!data) {
    // No row deleted: unknown (source, external_ref), or RLS hid it.
    return NextResponse.json({ error: "no such route" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Update `CLAUDE.md` — add the DELETE line + a CRUD note**

In `CLAUDE.md`, just below the `app/api/ingest/routes/route.ts` layout line added in Task 1, add:
```
app/api/ingest/routes/[external_ref]/route.ts  delete a route — DELETE (cascade stops)
```
And in the ingestion-related convention/prose, note that the ingestion seam is now full CRUD: create/update via `POST /api/ingest/routes`, delete via `DELETE /api/ingest/routes/:external_ref?source=…` (keyed by `(source, external_ref)`; stops cascade and the TV evicts them via Realtime).

- [ ] **Step 8: Full verification — typecheck, tests, build**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

Run: `pnpm build`
Expected: `✓ Compiled successfully`, and the route table lists `ƒ /api/ingest/routes` and `ƒ /api/ingest/routes/[external_ref]` (and no longer `/api/ingest/stops`). (Stop the dev server first if running, to avoid `.next` contention.)

- [ ] **Step 9: Commit**

```bash
git add lib/ingest-validate.ts lib/ingest-validate.test.ts app/api/ingest/routes/[external_ref]/route.ts CLAUDE.md
git commit -m "feat(ingest): add DELETE /api/ingest/routes/:external_ref"
```

---

## Self-Review

**Spec coverage:**
- "Dedicated `/api/ingest/routes` endpoint, body `{ routes }`" → Task 1. ✅
- "Create/update reuse `ingest_stops`, no DB change" → Task 1 Step 5 (`p_orders: parsed.routes`). ✅
- "DELETE by `(source, external_ref)`, cascade, dispatcher auth, 200/400/401/404/500" → Task 2 Step 5. ✅
- "Rename existing endpoint, update the two internal callers + docs, no alias" → Task 1 Steps 5–9. ✅
- "Hard delete (cascade)" → Task 2 (plain `.delete()`). ✅
- "Tests: `{ routes }` validation + delete-param validation" → Task 1 Step 1, Task 2 Step 1. ✅
- "No migration" → no migration file in any task. ✅
- Adapter / `orders.vehicle_id` / `delivery_routes` table → explicitly deferred in the spec; no task, by design. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the CLAUDE.md prose edit (Task 2 Step 7) specifies the exact sentence to add.

**Type consistency:** `validate` returns `{ routes }` (Task 1) and the POST handler reads `parsed.routes` (Task 1 Step 5). `validateDeleteParams` signature in Task 2 Step 1 (tests), Step 3 (impl), and Step 5 (handler call) match: `{ external_ref, source }` → `{ external_ref: string; source: string } | { error }`. The DELETE handler passes `searchParams.get("source")` (`string | null`) which `validateDeleteParams` accepts (handles `null`/`""` → `"manual"`).
