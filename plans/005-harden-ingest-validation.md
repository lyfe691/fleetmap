# Plan 005: Harden `/api/ingest/stops` validation (malformed input → 400, not 500)

> **Executor instructions**: Follow step by step; run every verification command.
> On a "STOP conditions" item, stop and report. Update the 005 row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- app/api/ingest/stops/route.ts supabase/migrations/0004_orders_stops.sql`
> If changed, compare excerpts to live code; on mismatch, treat as STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (input validation / robustness)
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

`POST /api/ingest/stops` validates the required fields well (`stop_type`, `seq`,
`lat`/`lng` ranges) but does **not** validate the optional fields it forwards to
the `ingest_stops` SQL function — `vehicle_id`, `eta_at`, and the order's
`scheduled_date`. Those are cast in PL/pgSQL (`::uuid`, `::timestamptz`,
`::date`). A malformed value (e.g. `vehicle_id: "not-a-uuid"`, `eta_at: "soon"`)
makes the cast throw, the whole batch rolls back, and the handler returns an
opaque `500 ingest failed` — indistinguishable from a real DB outage. This is the
ingestion seam other adapters will build on, so a precise `400` with a clear
message (instead of a silent `500`) materially improves DX and makes bad-adapter
bugs obvious. Validation-only change; no schema or SQL change.

## Current state

`app/api/ingest/stops/route.ts:14-58` — the `validate` function. It already has
an `isFiniteNumber` helper and per-stop checks. The optional fields it currently
passes through unchecked:

- order-level: `scheduled_date` (cast `::date` at `0004_orders_stops.sql:118`)
- stop-level: `vehicle_id` (cast `nullif(...,'')::uuid` at `0004:135`),
  `eta_at` (cast `::timestamptz` at `0004:141`)

Current per-stop validation block (`route.ts:38-55`) for reference:

```ts
    for (const s of ord.stops) {
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
    }
```

The SQL coerces empty string → null for `vehicle_id` (`nullif(s->>'vehicle_id','')`),
so **absent or empty** `vehicle_id` is valid (an unassigned stop). Validation must
allow undefined/empty and only reject a present non-UUID/non-ISO value.

Convention: `validate` returns `{ error: string }` on the first failure with a
human-readable message; mirror that style and message tone exactly. Keep helpers
small and local to the file.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 except known `calendar.tsx` error |
| Lint | `pnpm lint` | exit 0 |
| Manual: bad eta_at | see Step 3 | `400` with a clear message (not `500`) |

## Scope

**In scope**: `app/api/ingest/stops/route.ts` only.
**Out of scope**: the SQL function and migrations (no schema change), the
required-field checks (already correct), and `scripts/seed-stops.ts` (its payload
is already valid). Do not add a validation library — hand-rolled checks match the
file.

## Git workflow

- Branch: `advisor/005-harden-ingest-validation`.
- One commit: `fix(ingest): validate optional vehicle_id/eta_at/scheduled_date → 400 not 500`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Steps

### Step 1: Add small format helpers

Near `isFiniteNumber`, add two predicates. Use a UUID regex and `Date.parse` for
ISO timestamps/dates (no new dependency):

```ts
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

// Accepts ISO 8601 dates/timestamps; rejects unparseable strings.
function isIsoDateString(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v))
}
```

**Verify**: `pnpm exec tsc --noEmit` → only known `calendar.tsx` error.

### Step 2: Validate the optional fields

Treat a field as valid if it is **absent, null, or empty string** (the SQL nulls
those); only reject a present, non-empty, malformed value. Add inside the
per-stop loop (after the `lng` check):

```ts
      if (
        st.vehicle_id != null &&
        st.vehicle_id !== "" &&
        !isUuid(st.vehicle_id)
      ) {
        return { error: "stop.vehicle_id must be a UUID" }
      }
      if (
        st.eta_at != null &&
        st.eta_at !== "" &&
        !isIsoDateString(st.eta_at)
      ) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
```

And at the order level (after the `external_ref` / `stops` checks, before the
per-stop loop), validate `scheduled_date` if present:

```ts
      if (
        ord.scheduled_date != null &&
        ord.scheduled_date !== "" &&
        !isIsoDateString(ord.scheduled_date)
      ) {
        return { error: "order.scheduled_date must be an ISO 8601 date" }
      }
```

(Use `ord` — the already-narrowed `Record<string, unknown>` for the order.)

**Verify**: `pnpm exec tsc --noEmit` → only known `calendar.tsx` error;
`pnpm lint` → exit 0.

### Step 3: Manual check — bad input now returns 400

With `pnpm dev` running, mint a dispatcher token the way `scripts/seed-stops.ts`
does (or reuse a known-good token) and POST a payload with a deliberately bad
`eta_at` (e.g. `"eta_at": "soon"`) on one stop. Expected: HTTP `400` with body
`{"error":"stop.eta_at must be an ISO 8601 timestamp"}` — NOT a `500`. A valid
payload (run `pnpm seed-stops`) must still succeed with `200`.

If you cannot mint a token / run the stack, STOP and report that the change
typechecks but the 400-vs-500 behavior is unverified.

**Verify**: bad payload → 400 with the precise message; `pnpm seed-stops` → 200.

## Test plan

No automated suite. Verification:
- typecheck + lint clean;
- Step 3 manual: malformed `eta_at`/`vehicle_id`/`scheduled_date` → `400` with a
  field-specific message; the existing `pnpm seed-stops` payload still → `200`.

## Done criteria

ALL must hold:

- [ ] `validate` rejects a present non-UUID `vehicle_id`, non-ISO `eta_at`, and non-ISO `scheduled_date` with field-specific 400 messages.
- [ ] Absent/null/empty values for those fields are still accepted.
- [ ] `pnpm seed-stops` still returns 200 (regression check).
- [ ] `pnpm exec tsc --noEmit` exits 0 (except known error); `pnpm lint` exits 0.
- [ ] No SQL/migration files changed (`git status`).
- [ ] `plans/README.md` 005 row updated.

## STOP conditions

- The SQL function's cast expressions in `0004_orders_stops.sql` differ from the
  excerpts (different field names/casts) — the validation targets may be wrong;
  report.
- A valid `seed-stops` payload starts failing validation after your change — your
  predicate is too strict (likely rejecting empty/absent); fix or report.

## Maintenance notes

- If the ingest contract gains new optional fields with SQL casts, add a matching
  predicate here so malformed input fails as `400`, not `500`.
- This validates *format*, not *authorization*: whether a dispatcher may assign a
  stop to a given `vehicle_id` is an RLS/business-rule question tracked separately
  (the advisor rejected it as out of scope for V1 — dispatcher is a trusted
  identity). Don't add ownership checks here without a product decision.
