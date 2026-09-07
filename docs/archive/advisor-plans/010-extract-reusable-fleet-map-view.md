# Plan 010: Extract a reusable, presentational `<FleetMapView>` from `FleetMap`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a8b6215..HEAD -- components/map lib/use-fleet-routes.ts lib/route-slice.ts`
> If `components/map/fleet-map.tsx` changed since this plan was written, compare
> the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/009 (test baseline — gives `splitRoute`/route-features a net before refactor)
- **Category**: tech-debt / architecture
- **Planned at**: commit `a8b6215`, 2026-06-22

## Why this matters

The TV is getting a touchscreen and a **new UI prototype**. The map is the one
piece that carries over — it must be a flawless, production-clean, *reusable*
component the prototype can drop in, not something welded to the current
dashboard shell. Today `components/map/fleet-map.tsx` (≈700 lines) couples three
concerns into one component: (1) **data fetching** (the live hooks + session),
(2) the **durable map presentation** (canvas, area overlays, route lines,
markers, glide), and (3) **throwaway shell** (the `FleetRail` side panel,
fullscreen button, error/gate chrome). This plan separates them so the durable
map becomes a pure presentational component with an explicit prop API, and the
replaceable shell is clearly isolated. Nothing about the rendered output changes;
this is a structural extraction that makes the map portable.

## Current state

`components/map/fleet-map.tsx` (read the whole file before starting) contains, in
one module:

- `export function FleetMap({ displayCode })` — the top-level component. It:
  - calls the data hooks: `useLiveVehicles(displayCode)` → `{ vehicles, error, ready }`,
    `useLiveStops(ready)` → `{ stopsByVehicle }`, `useOperationalAreas(ready)` →
    `{ areas }`, `useNow(5000)` → `now`.
  - derives `jobs` (per-vehicle route jobs) via `useMemo`, then
    `routes = useFleetRoutes(jobs)`.
  - derives `nextStopIds`, `stopMarkers`, and `{ remaining, traveled }` (the
    latter via a `useMemo` over `[routes, vehicles]` that reads/writes
    `progressRef` and calls `splitRoute`).
  - renders: error `<Alert>`, `<FullscreenButton/>`, `<MapLegend areas/>`, the
    `<MapGL>` with area `<Source>`/`<Layer>`, area name `<Marker>`s, the
    traveled + remaining route `<Source>`/`<Layer>`s, `{stopMarkers}`, and the
    vehicle `<InterpolatedMarker>`s — and finally `<FleetRail .../>`.
- Helper components in the same file: `FleetRail`, `FleetRailRow`, `StatusDot`,
  `FullscreenButton`, `MapLegend`, `LegendDot`, `useGlide`, `InterpolatedMarker`,
  `VehicleMarker`, `StopMarker`, plus the pure helpers `isActive`, `formatEta`,
  `computeFleetBounds`, and the constant `STALE_AFTER_MS`/`MAP_STYLE`.
- `components/map/map-client.tsx` dynamically imports `FleetMap` (`ssr:false`)
  and is rendered by `components/map/dashboard-gate.tsx` after the display code
  is entered.

Data types (already defined, reuse — do not redefine): `Vehicle`
(`lib/use-live-vehicles.ts`), `Stop` (`lib/use-live-stops.ts`), `Route`
(`lib/route-types.ts`), `OperationalArea` (`lib/use-operational-areas.ts`),
`RouteSplit` (`lib/route-slice.ts`).

Conventions: `"use client"` at the top of client modules; import alias `@/*`;
no explanatory/gotcha comments beyond what's already the house style; TypeScript
throughout; `pnpm exec tsc --noEmit` and `pnpm lint` are the gates (plan 009 adds
`pnpm test`).

## Target architecture

Three layers, all under `components/map/`:

1. **`lib/use-route-features.ts`** (new) — a hook
   `useRouteFeatures(routes, vehicles)` returning `{ remaining, traveled }`
   GeoJSON `FeatureCollection`s. This is the `useMemo` + `progressRef` +
   `splitRoute` logic lifted verbatim out of `FleetMap`. Pure data-in/data-out;
   unit-testable.
2. **`components/map/fleet-map-view.tsx`** (new) — `export function FleetMapView`,
   a **presentational** component. Props:
   ```ts
   {
     vehicles: Vehicle[]
     stopsByVehicle: Map<string, Stop[]>
     routes: Map<string, Route>
     areas: OperationalArea[]
     now: number
   }
   ```
   It renders the `<MapGL>` and everything inside it (area overlays + labels,
   traveled/remaining route sources, stop markers, vehicle interpolated
   markers), plus `<FullscreenButton/>` and `<MapLegend/>`. It calls
   `useRouteFeatures`, derives `nextStopIds`/`stopMarkers`, owns the
   `mapRef`/`fitBounds` effect, and `useGlide`/`InterpolatedMarker`/
   `VehicleMarker`/`StopMarker` move here (or to their own files — see Step 2).
   **No data fetching, no `displayCode`, no session, no `FleetRail`.**
3. **`components/map/fleet-map.tsx`** (the data-bound container, kept) — keeps the
   `displayCode` prop, calls the live hooks + `useNow`, derives `jobs` →
   `routes`, renders the error `<Alert>`, then lays out
   `<FleetMapView .../>` beside `<FleetRail .../>`. This is the current
   dashboard shell; the prototype can either reuse it or import `FleetMapView`
   directly with its own data source.

`FleetRail` (+ `FleetRailRow`, `StatusDot`) move to
`components/map/fleet-rail.tsx` and are imported by the container. They are the
*replaceable* shell — keep them working but treat them as throwaway.

## Commands you will need

| Purpose   | Command                       | Expected on success      |
|-----------|-------------------------------|--------------------------|
| Typecheck | `pnpm exec tsc --noEmit`      | exit 0, no errors        |
| Tests     | `pnpm test`                   | all pass (incl. new)     |
| Lint      | `pnpm lint`                   | exit 0 (warnings ok)     |
| Build     | `pnpm build`                  | exit 0                   |
| Dev       | `pnpm dev` + `pnpm fake-gps`  | map renders, vans move   |

## Scope

**In scope**:
- `lib/use-route-features.ts` (create) + `lib/use-route-features.test.ts` (create)
- `components/map/fleet-map-view.tsx` (create)
- `components/map/fleet-rail.tsx` (create)
- `components/map/vehicle-marker.tsx` (create — `useGlide`, `InterpolatedMarker`, `VehicleMarker`, `StopMarker`)
- `components/map/fleet-map.tsx` (modify — becomes the thin container)

**Out of scope** (do NOT touch):
- The live hooks themselves (`use-live-vehicles`, `use-live-stops`,
  `use-operational-areas`, `use-fleet-routes`) — their behavior is unchanged;
  only their *call site* moves into the container.
- `lib/route-slice.ts` — reuse `splitRoute` as-is; do not change its logic.
- `map-client.tsx` / `dashboard-gate.tsx` — they import `FleetMap`, whose public
  signature (`{ displayCode }`) is unchanged.
- Any visual/styling change to the map output. This is a refactor; the rendered
  result must be pixel-identical.

## Git workflow

- Branch: `advisor/010-extract-fleet-map-view`
- Commit per layer (hook, then view+markers, then container) so each step is a
  reviewable, compiling unit. Conventional commits
  (e.g. `refactor(map): extract presentational FleetMapView + useRouteFeatures`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract `useRouteFeatures`

Create `lib/use-route-features.ts`. Move the `progressRef` declaration and the
`const { remaining, traveled } = useMemo(...)` block from `FleetMap` into a hook
`useRouteFeatures(routes: Map<string, Route>, vehicles: Vehicle[])` that returns
`{ remaining, traveled }`. Copy the logic **verbatim** (the forward-clamp via
`splitRoute(route.geometry, [v.last_lng, v.last_lat], prev)`, the `prog` cache
keyed on geometry identity, the prune of vehicles not `seen`). Import `Vehicle`
and `Route` types.

Add `lib/use-route-features.test.ts`: with a stub `routes` Map (one vehicle, a
simple LineString) and a `vehicles` array, assert `remaining.features` has one
feature for the located vehicle and none for a vehicle with `last_lat == null`.
(Model the test setup after `lib/route-slice.test.ts` from plan 009.)

**Verify**: `pnpm test` passes; `pnpm exec tsc --noEmit` exit 0 (hook not yet wired).

### Step 2: Move the marker components

Create `components/map/vehicle-marker.tsx` and move `useGlide`,
`InterpolatedMarker`, `VehicleMarker`, `StopMarker` into it (verbatim), exporting
`InterpolatedMarker`, `VehicleMarker`, `StopMarker`. Keep `STALE_AFTER_MS` where
it is consumed (or export it from a shared spot — keep it simple; duplicating the
single constant into the view module is acceptable if cleaner).

**Verify**: `pnpm exec tsc --noEmit` exit 0 (file compiles in isolation).

### Step 3: Create `FleetMapView`

Create `components/map/fleet-map-view.tsx` with the props in "Target
architecture". Move into it: the `mapRef`/`mapLoaded`/`fittedRef`/`fitBounds`
effect, `computeFleetBounds`, `areaFc` memo, `nextStopIds` memo, `stopMarkers`
memo, the `useRouteFeatures` call, `MapLegend`/`LegendDot`/`FullscreenButton`,
`formatEta`/`isActive` if used here, and the entire `<MapGL>` JSX subtree
(area overlays + labels, traveled/remaining sources, stop markers, vehicle
markers). Import markers from `./vehicle-marker`.

**Verify**: `pnpm exec tsc --noEmit` exit 0.

### Step 4: Extract `FleetRail`

Create `components/map/fleet-rail.tsx`, move `FleetRail`, `FleetRailRow`,
`StatusDot` (and the `formatEta`/`isActive` helpers they need — share via a tiny
`components/map/fleet-format.ts` if both view and rail need them, rather than
duplicating). Export `FleetRail`.

**Verify**: `pnpm exec tsc --noEmit` exit 0.

### Step 5: Reduce `FleetMap` to the container

Rewrite `components/map/fleet-map.tsx` to: keep `{ displayCode }`, call the live
hooks + `useNow`, derive `jobs` → `routes`, render the error `<Alert>`, then:

```tsx
return (
  <div className="flex h-full w-full">
    <div className="relative h-full flex-1">
      {error ? <ErrorAlert .../> : null}
      <FleetMapView
        vehicles={vehicles}
        stopsByVehicle={stopsByVehicle}
        routes={routes}
        areas={areas}
        now={now}
      />
    </div>
    <FleetRail vehicles={vehicles} stopsByVehicle={stopsByVehicle} routes={routes} areas={areas} now={now} />
  </div>
)
```

Keep the public signature `FleetMap({ displayCode }: { displayCode: string })`
so `map-client.tsx` is untouched.

**Verify**: `pnpm exec tsc --noEmit` exit 0; `pnpm lint` exit 0; `pnpm build` exit 0.

### Step 6: Runtime parity check

Run `pnpm dev` and `pnpm fake-gps`. Open `/dashboard`, enter the display code,
and confirm: area overlays + city labels render, vans glide, route lines show
the grey traveled / blue remaining split, stop markers appear with the next-stop
emphasis, the side rail lists vehicles by city with ETA, fullscreen works.
Output must be visually identical to before the refactor.

**Verify**: all of the above render correctly; no new console errors.

## Test plan

- New: `lib/use-route-features.test.ts` (per Step 1) — depends on the vitest
  harness from plan 009.
- Existing `lib/route-slice.test.ts` (plan 009) continues to pass — `splitRoute`
  is unchanged.
- Manual runtime parity per Step 6 (no component test harness yet).

## Done criteria

ALL must hold:

- [ ] `components/map/fleet-map-view.tsx` exists and takes `{ vehicles,
      stopsByVehicle, routes, areas, now }`, with **no** import of any
      `use-live-*` hook, `displayCode`, or `FleetRail`
      (`grep -nE "use-live|displayCode|FleetRail" components/map/fleet-map-view.tsx` → no matches)
- [ ] `FleetMap` still exports `{ displayCode }` and `map-client.tsx` is unchanged
- [ ] `pnpm exec tsc --noEmit` exit 0; `pnpm test` all pass; `pnpm build` exit 0
- [ ] Runtime parity confirmed (Step 6)
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

Stop and report if:

- The live `fleet-map.tsx` differs materially from the "Current state" excerpts
  (drift since planning).
- Achieving parity would require changing a live hook's behavior or the rendered
  output — report; do not change hook behavior to make the refactor fit.
- The `progressRef` forward-clamp cache can't be moved into `useRouteFeatures`
  without behavior change (e.g. it depends on render identity you can't preserve)
  — report rather than altering the split semantics.

## Maintenance notes

- `FleetMapView` is the artifact the new touchscreen prototype reuses: it has a
  documented prop API and no data/session coupling. Keep it that way — new data
  needs flow in as props, not new hooks inside the view.
- `FleetRail` (`fleet-rail.tsx`) is explicitly the **replaceable** shell; the
  prototype will likely discard it. Don't invest in it.
- Reviewer should scrutinize Step 1 (the split-features logic must be moved
  verbatim — diff against the original `useMemo`) and Step 6 parity.
- Follow-up deferred: render-perf hygiene (memoizing rows/markers, scoping the
  clock tick) is plan 011 — do it after this lands so it edits the new files.
