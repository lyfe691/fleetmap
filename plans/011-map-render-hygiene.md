# Plan 011: Map render hygiene — memoize rows/markers, scope the clock tick

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat <SHA of plan 010 landing>..HEAD -- components/map`
> This plan edits files **created by plan 010**. If plan 010 has not landed,
> STOP — this plan depends on it.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/010 (edits `fleet-map-view.tsx`, `fleet-rail.tsx`, `vehicle-marker.tsx`)
- **Category**: perf
- **Planned at**: commit `a8b6215`, 2026-06-22

## Why this matters

The map will run on a touchscreen TV for long, unattended sessions — smoothness
matters and there is no excuse for needless re-renders. A 5-second wall-clock
tick (`useNow(5000)`, used only for staleness labels) currently flows as a prop
through the whole tree, re-rendering every side-rail row and every vehicle marker
each tick even when nothing about that row/marker changed. The fix is standard
React hygiene: memoize the leaf components so a clock tick only re-renders the
specific nodes whose displayed time actually changed. This is low-risk polish,
not an algorithmic change — the heavy map layers are already `useMemo`'d and are
**not** the problem.

## Current state (after plan 010)

- `useNow(5000)` (`lib/use-now.ts`) returns `now: number`, re-rendering its
  consumer every 5s. It is consumed for staleness only:
  - In `FleetMapView`: the vehicle marker's `stale` flag
    (`now - new Date(v.last_seen_at).getTime() > STALE_AFTER_MS`).
  - In `FleetRail` → `FleetRailRow`: `stale` + `secondsAgo` display.
- `FleetRailRow` is a plain function component (not wrapped in `memo`), so every
  parent re-render (including each `now` tick) re-renders all rows. Each row runs
  `stops.filter(isActive)` and date math on every render.
- The vehicle markers are produced by an inline `vehicles.map(...)` in
  `FleetMapView`; `VehicleMarker` is a plain component.

(Exact line numbers depend on plan 010's extraction; locate by symbol name.)

## Commands you will need

| Purpose   | Command                       | Expected on success      |
|-----------|-------------------------------|--------------------------|
| Typecheck | `pnpm exec tsc --noEmit`      | exit 0, no errors        |
| Tests     | `pnpm test`                   | all pass                 |
| Lint      | `pnpm lint`                   | exit 0 (warnings ok)     |
| Dev       | `pnpm dev` + `pnpm fake-gps`  | map smooth, labels live  |

## Scope

**In scope**:
- `components/map/fleet-rail.tsx` — wrap `FleetRailRow` in `React.memo`
- `components/map/vehicle-marker.tsx` — wrap `VehicleMarker` (and `StopMarker`
  if trivially pure) in `React.memo`
- `components/map/fleet-map-view.tsx` — only if needed to keep marker props
  referentially stable (e.g. avoid recreating inline objects/callbacks that
  would defeat the `memo`)

**Out of scope**:
- `lib/use-now.ts` — keep the hook as-is; do not build a context/store for it in
  this plan (the memoization below is sufficient and simpler — KISS).
- Any data hook, `splitRoute`, `useRouteFeatures`, or map layer/source logic.
- Virtualization of the rail, RAF coalescing across markers, snapshot pagination
  — explicitly deferred (see Maintenance notes); they are not justified at this
  fleet's scale.

## Git workflow

- Branch: `advisor/011-map-render-hygiene`
- Conventional commits (e.g. `perf(map): memoize rail rows and vehicle markers`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Memoize `FleetRailRow`

Wrap the component: `const FleetRailRow = memo(function FleetRailRow({ ... }) { ... })`
(import `memo` from `react`). Its props are `v`, `stops`, `eta`, `now` — all
already passed explicitly. With `memo`, a row re-renders on a `now` tick only if
its props changed by identity; ensure the parent passes stable `stops`
(`stopsByVehicle.get(v.id)` returns the same array reference between ticks
because `stopsByVehicle` only changes on a stops event — confirm this holds).

**Verify**: `pnpm exec tsc --noEmit` exit 0.

### Step 2: Memoize the marker leaves

Wrap `VehicleMarker` (and `StopMarker` if its props are all primitives) in
`memo`. Confirm the props passed in `FleetMapView` are primitives/stable (e.g.
`heading`, `label`, `stale` booleans/numbers) so the memo is effective.

**Verify**: `pnpm exec tsc --noEmit` exit 0.

### Step 3: Confirm no behavior change

Run `pnpm dev` + `pnpm fake-gps`, open `/dashboard`. Confirm staleness still
updates: stop the fake feed and within ~30s a van's marker fades and its rail row
shows "stale" / rising "Ns ago". Confirm vans still glide smoothly while the feed
runs.

**Verify**: staleness transitions still occur; motion is smooth; no console errors.

## Test plan

No new unit tests (this is render-timing behavior, not pure logic). Verification
is the typecheck gate plus the manual staleness/motion check in Step 3. The
existing plan-009/010 suites must still pass (`pnpm test`).

## Done criteria

ALL must hold:

- [ ] `FleetRailRow` and `VehicleMarker` are wrapped in `memo`
      (`grep -nE "memo\(" components/map/fleet-rail.tsx components/map/vehicle-marker.tsx` → matches)
- [ ] `pnpm exec tsc --noEmit` exit 0; `pnpm test` all pass; `pnpm lint` exit 0
- [ ] Staleness still updates and motion is smooth (Step 3)
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

Stop and report if:

- `stopsByVehicle.get(v.id)` returns a **new** array reference every render
  (which would make the row `memo` ineffective) — report; the fix would be in
  `use-live-stops` (out of scope here).
- Memoizing causes a stale label to stop updating — report (means a prop the row
  depends on isn't being passed).

## Maintenance notes

- Deferred by design (record so they aren't re-audited): rail **virtualization**,
  **RAF coalescing** across vehicle markers, and **snapshot pagination** in the
  live hooks. All are scale-driven and unjustified for a fleet of tens of
  vehicles. Revisit only if a single dashboard regularly shows ~100+ vehicles.
- If the new prototype keeps a different list UI instead of `FleetRail`, this
  row-memo work may be discarded with it — that's fine; the marker memoization in
  `vehicle-marker.tsx` is the part that travels with the durable map.
