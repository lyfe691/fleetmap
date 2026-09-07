# Plan 009: Stand up a test baseline (vitest) over the map's pure logic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a8b6215..HEAD -- lib/route-slice.ts lib/geofence.ts app/api/ingest/stops/route.ts lib/use-location-sync.ts package.json`
> If any of those changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (but should land before plan 010, which refactors the map)
- **Category**: tests
- **Planned at**: commit `a8b6215`, 2026-06-22

## Why this matters

The repo has **no test runner and no tests**. The only verification gate is
`tsc --noEmit` + lint. The map is about to become the durable, reused artifact
for a new touchscreen UI prototype, and plan 010 refactors the map's rendering
internals — that refactor is unsafe without a regression net. The highest-value
net is on the **pure** logic that drives route rendering, because it is
correctness-sensitive and trivially testable with no Supabase/DOM mocking:
`splitRoute` (the traveled/remaining forward-clamp split — the single most
delicate piece of the rendering path), the geofence transition math, and the
ingest validator. This plan establishes vitest and covers those, so plan 010 (and
all future map work) can refactor with confidence.

## Current state

- **No test infra exists**: no `vitest`/`jest` in `package.json`, no
  `*.test.ts`, no test script. `package.json` scripts today: `dev`, `build`,
  `start`, `lint`, `format`, `typecheck`, plus tsx script aliases.
- **`lib/route-slice.ts`** exports `splitRoute(geometry, position, prev)` and
  type `RouteSplit`. Pure function, no I/O. Key behaviors to lock in
  (from the source):
  - Projects `position` onto the LineString via `@turf/nearest-point-on-line`.
  - The boundary only moves **forward**: with a non-null `prev`, a `rawLoc` that
    is `< prev.location` OR `> prev.location + MAX_FORWARD_KM` (2 km) returns
    `prev` unchanged (rejects backward jumps and teleport/jitter).
  - `rawLoc <= 0` or `coords.length < 2` → `{ traveled: null, remaining: geometry, location: 0 }`.
  - Otherwise splits into `traveled` (start→snap) and `remaining` (snap→end) via
    `@turf/line-slice`, and returns `location: rawLoc`.
- **`lib/geofence.ts`** — server-side geofence auto-arrive helper used by
  `POST /api/location` (two-radius hysteresis, next-stop-by-seq). **Read this
  file before writing its tests** — its exact exported function name(s) and
  signature are not reproduced here; cover the pure decision logic it exposes
  (haversine distance + the arrive/advance transition given a position and an
  ordered stop list). If its logic is not exported as a pure, importable
  function (i.e. it only runs inside the route handler with a DB client), that
  is a STOP condition — note it and cover `route-slice` + the validator only.
- **`app/api/ingest/stops/route.ts`** contains a pure `validate(body)` function
  (lines ~30–94) returning `{ orders } | { error }`. It is **not exported**
  today. Behaviors: rejects non-object body, empty `orders`, missing
  `external_ref`, non-`pickup`/`dropoff` `stop_type`, non-integer `seq`, lat
  out of [-90,90], lng out of [-180,180], non-UUID `vehicle_id`/`area_id`,
  non-ISO `scheduled_date`/`eta_at`.

Convention: TypeScript throughout, ESM (`"type": "module"`), import alias
`@/*` → project root. Match existing code style (no test framework precedent
exists, so this plan sets it).

## Commands you will need

| Purpose   | Command                       | Expected on success      |
|-----------|-------------------------------|--------------------------|
| Install   | `pnpm add -D vitest`          | exit 0                   |
| Typecheck | `pnpm exec tsc --noEmit`      | exit 0, no errors        |
| Tests     | `pnpm test`                   | all pass                 |
| Lint      | `pnpm lint`                   | exit 0 (warnings ok)     |

## Suggested executor toolkit

- vitest resolves the `@/*` alias via `vite-tsconfig-paths` OR an explicit
  `resolve.alias` in `vitest.config.ts`. Use the explicit alias approach to
  avoid adding another dependency (see Step 1).

## Scope

**In scope** (create unless noted):
- `package.json` — add `vitest` devDep + `"test": "vitest run"` and
  `"test:watch": "vitest"` scripts
- `vitest.config.ts` (create)
- `lib/route-slice.test.ts` (create)
- `lib/geofence.test.ts` (create — only if geofence exposes pure logic; see above)
- `lib/ingest-validate.ts` (create) + `lib/ingest-validate.test.ts` (create) —
  see Step 4 (extract the validator so it is importable)
- `app/api/ingest/stops/route.ts` — modify ONLY to import the extracted
  `validate` from `lib/ingest-validate.ts` instead of its inline copy

**Out of scope** (do NOT touch):
- Any map component (`components/map/*`) — plan 010 owns those.
- Any Supabase client, Realtime hook, or React component — no DOM/Supabase
  mocking in this plan. Pure-function coverage only.
- The behavior of `validate` — Step 4 is a pure **move**, not a logic change.

## Git workflow

- Branch: `advisor/009-test-baseline-vitest`
- Commit style: conventional commits (e.g. `test: add vitest baseline for route-slice + ingest validation`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add vitest and config

`pnpm add -D vitest`. Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: { environment: "node", include: ["**/*.test.ts"] },
})
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

**Verify**: `pnpm test` → exits 0 with "No test files found" (or runs 0 tests).

### Step 2: Test `splitRoute` (`lib/route-slice.test.ts`)

Use a simple straight LineString, e.g. coordinates
`[[0,0],[0,1],[0,2],[0,3]]` (a meridian; lengths are well-defined). Cover:

- **At start**: position at `[0,0]` with `prev=null` → `traveled` is `null`,
  `remaining` equals the full geometry, `location` is `0`.
- **Midway**: position near `[0,1.5]`, `prev=null` → `traveled` non-null,
  `remaining` non-null, `location` > 0.
- **Forward-clamp rejects backward**: compute a `prev` at a mid location, then
  call with a position projecting *behind* it → returns `prev` unchanged
  (same `location`).
- **Forward-clamp rejects teleport**: `prev` at low location, position
  projecting more than `MAX_FORWARD_KM` (2 km, i.e. >~0.018° of latitude here)
  ahead → returns `prev` unchanged.
- **Forward move accepted**: `prev` at low location, position a small step ahead
  (< 2 km) → `location` advances.
- **Degenerate geometry**: `coordinates` of length 1 → returns
  `{ traveled: null, remaining: geometry, location: 0 }`.

**Verify**: `pnpm test` → these tests pass.

### Step 3: Test geofence pure logic (`lib/geofence.test.ts`)

Read `lib/geofence.ts`. If it exports pure, importable decision logic, cover:
its distance computation (a known pair of coords → expected metres within a
tolerance), the **arrive** transition (inside the inner radius → arrive), the
**no-arrive** hold between inner and outer radius (hysteresis), and next-stop
selection by ascending `seq`. If it does NOT export pure logic (only a DB-bound
handler helper), skip this file and note it in your completion report — do not
invent a refactor of `geofence.ts` here (that is out of scope).

**Verify**: `pnpm test` → geofence tests pass (or are justifiably skipped).

### Step 4: Extract and test the ingest validator

Move the `validate` function (and its helpers `isFiniteNumber`, `isUuid`,
`isIsoDateString`, `UUID_RE`) from `app/api/ingest/stops/route.ts` into a new
`lib/ingest-validate.ts`, exporting `validate`. In the route handler, replace
the inline definitions with `import { validate } from "@/lib/ingest-validate"`.
**Do not change the validation logic** — this is a move so it can be unit-tested.

Then write `lib/ingest-validate.test.ts` covering: a valid payload returns
`{ orders }`; and each rejection branch returns the matching `{ error }`
(empty orders, missing `external_ref`, bad `stop_type`, non-integer `seq`,
lat/lng out of range, non-UUID `vehicle_id`, non-ISO `eta_at`).

**Verify**:
- `pnpm exec tsc --noEmit` → exit 0 (route handler still compiles with the import).
- `pnpm test` → validator tests pass.

### Step 5: Final gate

**Verify**: `pnpm test` all pass; `pnpm exec tsc --noEmit` exit 0; `pnpm lint`
exit 0.

## Test plan

This plan IS the test plan. New files: `lib/route-slice.test.ts`,
`lib/geofence.test.ts` (conditional), `lib/ingest-validate.test.ts`. There is no
prior test to model after — these establish the pattern: pure imports from `@/`,
`describe`/`it`/`expect` from vitest, no mocks.

## Done criteria

ALL must hold:

- [ ] `pnpm test` exits 0; `route-slice` and `ingest-validate` suites exist and pass
- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `validate` now lives in `lib/ingest-validate.ts` and the route imports it;
      `grep -n "function validate" app/api/ingest/stops/route.ts` returns nothing
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report if:

- `lib/geofence.ts` exposes no pure importable logic (cover the other two and
  report this).
- Extracting `validate` changes any handler behavior or breaks tsc in a way a
  pure move shouldn't (report the conflict).
- A test reveals `splitRoute` does NOT behave as described in "Current state"
  (e.g. a backward jump is NOT rejected) — that is a real finding; report it
  rather than weakening the test to make it pass.

## Maintenance notes

- This sets the testing convention for the repo. Plan 010 will add
  `lib/use-route-features.test.ts` (the extracted split-features hook) on top of
  this harness.
- A reviewer should confirm Step 4 is a behavior-preserving move (diff the moved
  code against the original inline version line-for-line).
- Deferred intentionally: React component tests and any Supabase-mocking
  integration tests — out of scope here; revisit once a component testing setup
  (jsdom/RTL) is justified by the new prototype.
