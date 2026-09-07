# Plan 004: Stop rebuilding the stop-marker list on every `useNow` tick

> **Executor instructions**: Follow step by step; run every verification command.
> On a "STOP conditions" item, stop and report. Update the 004 row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- components/map/fleet-map.tsx lib/use-now.ts`
> If changed, compare excerpts to live code; on mismatch, treat as STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

`FleetMap` calls `useNow(5000)`, which sets new state every 5 seconds to refresh
wall-clock-derived staleness. That re-renders the entire component every tick —
including rebuilding the **stop-marker JSX list**, which does not depend on time
at all. On a TV dashboard running for hours this is wasted work every 5s. The
vehicle markers and the rail genuinely need `now` (staleness/"Xs ago"), so the
goal is narrow: memoize the parts that don't depend on `now` so the tick only
touches what it must. This is a small, safe optimization — do not over-engineer
it (YAGNI): no context, no new hooks, no library.

## Current state

`components/map/fleet-map.tsx`:

- `const now = useNow(5000)` (line ~46).
- The stop markers are built inline in the JSX from `stopsByVehicle` and
  `nextStopIds` (neither depends on `now`), around lines 425-435 in the M8
  source:

```tsx
{Array.from(stopsByVehicle.values())
  .flat()
  .map((s) => (
    <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="center">
      <StopMarker
        stopType={s.stop_type}
        status={s.status}
        emphasized={nextStopIds.has(s.id)}
      />
    </Marker>
  ))}
```

- The vehicle markers DO use `now` (staleness), and `FleetRail` uses `now` — both
  must keep re-rendering on the tick.
- `useNow` (`lib/use-now.ts`) is correct and shared; leave it unchanged.

The file already uses `useMemo` (e.g. the `remaining`/`traveled` split memo), so
the pattern is established here.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 except known `calendar.tsx` error |
| Lint | `pnpm lint` | exit 0 (no new exhaustive-deps warnings) |

## Scope

**In scope**: `components/map/fleet-map.tsx` only.
**Out of scope**: `lib/use-now.ts` (it's correct and shared), the vehicle-marker
rendering (it needs `now`), the route-split memo, and `FleetRail`. Do not change
the staleness threshold or any visual styling.

## Git workflow

- Branch: `advisor/004-memoize-stop-markers`.
- One commit: `perf: memoize stop-marker list so the 5s now-tick doesn't rebuild it`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Steps

### Step 1: Memoize the stop-marker elements

Extract the inline stop-marker map into a `useMemo` keyed on its real
dependencies — `stopsByVehicle` and `nextStopIds` — and render the memoized
array in the JSX. Target shape (place the memo near the other memos, above the
`return`):

```tsx
const stopMarkers = useMemo(
  () =>
    Array.from(stopsByVehicle.values())
      .flat()
      .map((s) => (
        <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="center">
          <StopMarker
            stopType={s.stop_type}
            status={s.status}
            emphasized={nextStopIds.has(s.id)}
          />
        </Marker>
      )),
  [stopsByVehicle, nextStopIds]
)
```

Then in the JSX replace the inline block with `{stopMarkers}`.

**Verify**: `pnpm exec tsc --noEmit` → only known `calendar.tsx` error.
`pnpm lint` → exit 0 (the memo deps are exactly `stopsByVehicle`, `nextStopIds`).

### Step 2: Confirm the tick no longer rebuilds stops (optional but preferred)

With `pnpm dev` + `/dashboard` + `pnpm fake-gps` running, open React DevTools
Profiler (or add a temporary `console.log` inside the memo factory and confirm it
logs only when stops change, not every 5s — remove the log before committing).
If DevTools isn't available, rely on the lint/type gates and skip this step.

**Verify**: stop markers still render correctly (next stop emphasized, terminal
stops faded); no visual change.

## Test plan

No automated suite. Verification is the typecheck + lint, plus the optional
Profiler/log check in Step 2. Confirm visually that the stop markers look
identical to before (this is a pure performance refactor).

## Done criteria

ALL must hold:

- [ ] The stop-marker list is produced by a `useMemo` keyed on `[stopsByVehicle, nextStopIds]`, rendered as `{stopMarkers}`.
- [ ] No temporary `console.log` left in the file.
- [ ] `pnpm exec tsc --noEmit` exits 0 (except known error); `pnpm lint` exits 0.
- [ ] Stop markers render unchanged (emphasis + fade intact).
- [ ] `plans/README.md` 004 row updated.

## STOP conditions

- The stop-marker block in the live file differs materially from the excerpt
  (e.g. it already references `now`) — reassess; the premise is that it's
  time-independent.
- Memoizing introduces a lint exhaustive-deps warning that can't be satisfied by
  the two listed deps — report rather than adding unrelated deps.

## Maintenance notes

- This is a marginal optimization; the bigger lever (if ever needed) is splitting
  `FleetRail` and the map into siblings so `now` only re-renders the rail. That's
  deliberately deferred — don't do it unless profiling shows the map subtree is a
  real cost.
- If stop markers later need time-derived state (e.g. a per-stop ETA countdown),
  this memo's dep list must add `now` — at which point this optimization no
  longer applies and should be revisited.
