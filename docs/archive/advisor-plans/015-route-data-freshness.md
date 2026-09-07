# Plan 015: Route data freshness — suppress stale ETAs and stop dropping a route on a transient OSRM failure

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3f5e84b..HEAD -- lib/console/use-console-data.ts lib/use-fleet-routes.ts lib/route-types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3f5e84b`, 2026-06-23

## Why this matters

Two route-data bugs degrade the console's live display:

1. **Stale ETA (wrong stop).** A vehicle's route is refetched asynchronously when
   its stop set changes (`stopsKey`). In the window before the new route arrives,
   `buildConsoleVehicles` reads `route.legs[0].duration` — which is the ETA to the
   **old** next stop — while the displayed "next stop" already reflects the new
   one. So the rail/card briefly shows an ETA to a stop the van is no longer
   heading to.

2. **Route vanishes on a transient hiccup.** `useFleetRoutes` deletes a vehicle's
   cached route on *any* failed refetch, including a transient `502` from OSRM or
   a network blip. Because the fetch effect only re-runs when `stopsKey` changes,
   the route line + ETA stay gone until the stop set happens to change again —
   potentially the rest of the shift.

Both are small, isolated, and high-confidence. After this plan: a mismatched ETA
shows `—` instead of a wrong number, and a transient OSRM failure keeps the last
good line on screen and retries naturally on the next stop change.

## Current state

### Bug 1 — `lib/console/use-console-data.ts`

```ts
// use-console-data.ts:62-73 (inside vehicles.map)
const stops = stopsByVehicle.get(v.id) ?? []
const active = stops.filter(isActive)
const hasActive = active.length > 0
const next = active[0] ?? null
const route = routes.get(v.id)

const stale = isStale(v.last_seen_at, now)
const etaSec = route?.legs?.[0]?.duration ?? null   // <-- BUG 1: no check that legs[0] is the CURRENT next stop
```

`Route.legs[]` carries the stop identity per leg — `RouteLeg.toStopId`
(`lib/route-types.ts:7-11`):

```ts
export type RouteLeg = {
  toStopId: string
  duration: number // seconds
  distance: number // metres
}
```

`Stop` has `id` (`lib/use-live-stops.ts:7-16`), so `next.id` is comparable to
`legs[0].toStopId`.

### Bug 2 — `lib/use-fleet-routes.ts`

```ts
// use-fleet-routes.ts:9-20 — fetchRoute collapses every non-ok to null
async function fetchRoute(vehicleId: string, token: string): Promise<Route | null> {
  const res = await fetch(`/api/route?vehicleId=${encodeURIComponent(vehicleId)}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  return (await res.json()) as Route
}

// use-fleet-routes.ts:58-66 — on null, the cache entry is DELETED
await Promise.all(
  current.map(async (j) => {
    const cached = cache.get(j.vehicleId)
    if (cached && cached.stopsKey === j.stopsKey) return
    const route = await fetchRoute(j.vehicleId, token)
    if (route) cache.set(j.vehicleId, { stopsKey: j.stopsKey, route })
    else cache.delete(j.vehicleId)          // <-- BUG 2: a transient 502 wipes the line
  })
)
```

The effect deps are `[jobsKey]` (`:76`) on purpose — routes must NOT refetch on
GPS pings. That design is correct; the fix must preserve it.

`/api/route` status codes (verified in `app/api/route/route.ts`):
- `200` → route body.
- `409` → idle: no such vehicle / no known position / no active stops.
- `404` → OSRM returned a valid "no path" answer.
- `502` / `500` / network throw → transient upstream/server failure.
- `401` → auth.

So: `409`/`404` mean "there is legitimately no current route" (remove); anything
else non-ok is transient (keep the last good line).

**Repo conventions to match**: `buildConsoleVehicles` is a pure function with an
existing unit test pattern (`lib/route-slice.test.ts`, `lib/geofence.test.ts` —
`vitest`, `environment: "node"`). The codebase models outcomes as small
discriminated unions (see `PostResult` in `lib/use-location-sync.ts:34-57`) —
follow that for the new fetch outcome type.

## Commands you will need

| Purpose   | Command                              | Expected on success      |
|-----------|--------------------------------------|--------------------------|
| Install   | `corepack pnpm install`              | exit 0                   |
| Typecheck | `corepack pnpm exec tsc --noEmit`    | exit 0, no errors        |
| Tests     | `corepack pnpm test`                 | all pass (40 + new)      |
| Lint      | `corepack pnpm lint`                 | no *new* errors          |

> Note: use `corepack pnpm …` — `pnpm` is not on the non-interactive PATH.
> `corepack pnpm lint` is pre-existing-red; only avoid adding *new* errors.

## Scope

**In scope**:
- `lib/console/use-console-data.ts`
- `lib/console/use-console-data.test.ts` (create)
- `lib/use-fleet-routes.ts`

**Out of scope** (do NOT touch):
- The `[jobsKey]` dependency of the fetch effect — do not make it refetch on GPS
  pings.
- `app/api/route/route.ts` — the server is correct; this is all client-side.
- `lib/route-slice.ts` / `lib/use-route-features.ts` — the traveled/remaining
  split already handles a kept route fine.

## Git workflow

- Branch: `advisor/015-route-data-freshness`
- Commit per bug; message style conventional commits, e.g.
  `fix(console): suppress ETA to a stale stop during route refetch`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1 (Bug 1): Guard the ETA on the current next stop

In `lib/console/use-console-data.ts`, replace the `etaSec` derivation:

```ts
const firstLeg = route?.legs?.[0]
// Only trust the leg duration if the route's first leg still targets the
// current next stop. During an async refetch after a stop change, legs[0]
// points at the OLD next stop — show "—" rather than a wrong ETA.
const etaFresh =
  firstLeg != null && next != null && firstLeg.toStopId === next.id
const etaSec = etaFresh ? firstLeg.duration : null
```

Everything downstream already handles `etaSec == null` (renders `—` / "En route").
Do not change those branches.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 2 (Bug 1): Unit-test the freshness guard

Create `lib/console/use-console-data.test.ts`. `buildConsoleVehicles` is exported
and pure. Cover:

- **Fresh route**: one active stop with `id: "s1"`, a route whose `legs[0]` has
  `toStopId: "s1"` and `duration: 600` → `etaText` formats from 600s
  (expect `"10 min"`).
- **Stale route**: same active stop `s1`, but `legs[0].toStopId: "s0"` (old
  stop) → `etaText` is `"—"` (not a wrong number), while `tone`/`statusLabel`
  remain `onRoute`/`"On Route"`.
- **No route**: no entry in `routes` for the vehicle → `etaText` `"—"`,
  `routeTimer` `"—"`.

Build minimal `Vehicle`/`Stop`/`Route` fixtures inline (only the fields the
function reads). Model the file after `lib/route-slice.test.ts`.

**Verify**: `corepack pnpm test` → all pass, including the 3 new cases.

### Step 3 (Bug 2): Classify the fetch outcome instead of returning `null`

In `lib/use-fleet-routes.ts`, replace `fetchRoute` with a version that
distinguishes "no current route" from "transient failure":

```ts
type FetchOutcome =
  | { kind: "ok"; route: Route }
  | { kind: "gone" }       // 404/409 — legitimately no current route
  | { kind: "transient" }  // 5xx / network / unexpected — keep the last good line

async function fetchRoute(
  vehicleId: string,
  token: string
): Promise<FetchOutcome> {
  let res: Response
  try {
    res = await fetch(`/api/route?vehicleId=${encodeURIComponent(vehicleId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    return { kind: "transient" } // network down
  }
  if (res.ok) return { kind: "ok", route: (await res.json()) as Route }
  if (res.status === 404 || res.status === 409) return { kind: "gone" }
  return { kind: "transient" }
}
```

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 4 (Bug 2): Apply the outcome — keep the last good line on a transient failure

Update the `Promise.all` body:

```ts
await Promise.all(
  current.map(async (j) => {
    const cached = cache.get(j.vehicleId)
    if (cached && cached.stopsKey === j.stopsKey) return
    const outcome = await fetchRoute(j.vehicleId, token)
    if (outcome.kind === "ok") {
      cache.set(j.vehicleId, { stopsKey: j.stopsKey, route: outcome.route })
    } else if (outcome.kind === "gone") {
      cache.delete(j.vehicleId)
    }
    // "transient": leave the cache entry untouched. The (slightly stale) line
    // stays visible, and because its stopsKey still differs from j.stopsKey,
    // the next jobsKey change retries the fetch naturally.
  })
)
```

> Why this is safe and self-healing: on a transient failure we neither set nor
> delete. If an entry existed, its `stopsKey` is unchanged (≠ `j.stopsKey`), so
> the next time `jobsKey` changes the `if (cached && cached.stopsKey === j.stopsKey)`
> guard is false and it refetches. If no entry existed, nothing is shown (no
> worse than before) and it likewise retries on the next jobsKey change.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0, and `corepack pnpm test` → all pass.

### Step 5: Confirm the two fixes compose

Reason through (no code change): when a transient failure keeps a stale line, the
kept route's `legs[0].toStopId` may not match the current `next.id` — Step 1 then
renders the ETA as `—`. So the user sees the last good *line* (better than a
vanished route) but never a *wrong ETA number*. Confirm your code produces this.

**Verify**: `corepack pnpm test` → all pass.

## Test plan

- `lib/console/use-console-data.test.ts` (new): the 3 cases in Step 2 (fresh /
  stale / missing route). These directly lock Bug 1.
- Bug 2 is in a React hook with no component-test harness in this repo; do NOT
  add one. Its correctness rests on `tsc`, the typed `FetchOutcome`, and the
  reasoning in Steps 4–5. Document a manual check in the PR description: with the
  fake feed running, stop the OSRM container briefly (`docker compose stop osrm`)
  during a stop transition and confirm the existing route line stays drawn (does
  not disappear); restart OSRM and confirm it refreshes on the next stop change.
- Pattern to follow: `lib/route-slice.test.ts`.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0; `lib/console/use-console-data.test.ts` exists
      with ≥3 passing cases
- [ ] `grep -n 'toStopId' lib/console/use-console-data.ts` shows the freshness guard
- [ ] `grep -n 'transient' lib/use-fleet-routes.ts` shows the new outcome handling
- [ ] `grep -n 'cache.delete' lib/use-fleet-routes.ts` shows delete happens ONLY
      in the `gone` branch
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `RouteLeg` no longer has `toStopId`, or `Stop` no longer has `id` (excerpts
  drifted).
- `/api/route` no longer returns 409 for idle / 502 for upstream errors (re-read
  `app/api/route/route.ts`; the 404/409 vs transient split is load-bearing).
- A test would require rendering the `useFleetRoutes` hook (needs a harness) —
  switch to the documented manual check instead.

## Maintenance notes

- If route fetching ever gains an explicit retry/backoff timer, the "retry on
  next jobsKey change" reasoning in Step 4 becomes redundant — simplify then.
- If `/api/route` adds new status codes, revisit the `gone` vs `transient` split.
- A reviewer should scrutinize that `cache.delete` is unreachable for the
  `transient` branch — that single line is the whole Bug-2 fix.
