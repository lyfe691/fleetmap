# Plan 002: Remove the dead `useRoute` hook; extract shared route types

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> "STOP conditions" item occurs, stop and report. When done, update the 002 row
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- lib/use-route.ts lib/use-fleet-routes.ts lib/route-slice.ts components/map/fleet-map.tsx`
> If any changed since this plan was written, compare the excerpts below to the
> live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but Plan 003 depends on this — do 002 first)
- **Category**: tech-debt
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

`lib/use-route.ts` exports a `useRoute` hook plus the route **types** (`Route`,
`RouteGeometry`, `RouteLeg`, `StopOffset`, `RouteStop`). The M7→M8 rewrite
replaced per-vehicle `useRoute` with the batched `useFleetRoutes`, so the hook
now has **zero call sites** — only its types are still imported. A dead exported
hook is a maintenance trap: it reads as live code, duplicates the fetch pattern
already in `useFleetRoutes`, and invites someone to "reuse" it. Deleting it (and
moving the still-used types to a types-only module) shrinks the surface and makes
the live route path obvious. This is a YAGNI/DRY cleanup with no behavior change.

## Current state

- `lib/use-route.ts` — defines and exports `useRoute(vehicleId, stopsKey)` plus
  all the route types. Grep confirms **no file calls `useRoute(`**; only type
  imports (`import type { Route, ... } from "@/lib/use-route"`) exist.
- Importers of the **types** from `@/lib/use-route`:
  - `components/map/fleet-map.tsx:23` — `import type { Route, RouteGeometry } from "@/lib/use-route"`
  - `lib/use-fleet-routes.ts:5` — `import type { Route } from "@/lib/use-route"`
  - `lib/route-slice.ts:3` — `import type { RouteGeometry } from "@/lib/use-route"`

The type block to preserve, verbatim from `lib/use-route.ts:6-40`:

```ts
// OSRM with geometries=geojson returns a LineString for the route shape.
export type RouteGeometry = {
  type: "LineString"
  coordinates: [number, number][]
}

export type RouteLeg = {
  toStopId: string
  duration: number // seconds
  distance: number // metres
}

export type StopOffset = {
  stopId: string
  seq: number
  lineFraction: number // 0..1 along the full geometry; M8's grey boundary
}

export type RouteStop = {
  id: string
  seq: number
  stop_type: "pickup" | "dropoff"
  lat: number
  lng: number
  status: string
}

export type Route = {
  geometry: RouteGeometry
  totalDuration: number // seconds (ETA to the last stop)
  totalDistance: number // metres
  legs: RouteLeg[]
  stopOffsets: StopOffset[]
  stops: RouteStop[]
}
```

Convention: `lib/` modules are `@/lib/...` imported; a types-only module needs no
`"use client"` directive (it ships no runtime code). Match the existing comment
text exactly when moving the types.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Find hook call sites | `grep -rn "useRoute(" app components lib hooks` | no matches (only the definition, which you delete) |
| Find type imports | `grep -rn "@/lib/use-route" app components lib hooks` | after Step 3: no matches |
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 except the known `components/ui/calendar.tsx` error |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:
- `lib/route-types.ts` (create)
- `lib/use-route.ts` (delete)
- `lib/use-fleet-routes.ts` (update import only)
- `lib/route-slice.ts` (update import only)
- `components/map/fleet-map.tsx` (update import only)

**Out of scope**: any logic change in the three importers — only their import
lines change. Do not alter `useFleetRoutes` internals (that is Plan 003).

## Git workflow

- Branch: `advisor/002-remove-dead-useroute`.
- One commit: `refactor: drop dead useRoute hook, move route types to route-types`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Steps

### Step 1: Confirm the hook is dead

Run `grep -rn "useRoute(" app components lib hooks`. Expect the ONLY match to be
the definition line in `lib/use-route.ts` (`export function useRoute(`). If any
other file calls `useRoute(`, STOP — it is not dead; report.

**Verify**: command output shows only the definition.

### Step 2: Create `lib/route-types.ts`

Create the file containing exactly the type block from "Current state" (the five
`export type` declarations and their comments). No imports, no `"use client"`.

**Verify**: `pnpm exec tsc --noEmit` → unchanged error set (the file isn't
imported yet).

### Step 3: Repoint the three type importers

Change the import source from `@/lib/use-route` to `@/lib/route-types` in:

- `lib/use-fleet-routes.ts:5` → `import type { Route } from "@/lib/route-types"`
- `lib/route-slice.ts:3` → `import type { RouteGeometry } from "@/lib/route-types"`
- `components/map/fleet-map.tsx:23` → `import type { Route, RouteGeometry } from "@/lib/route-types"`

**Verify**: `grep -rn "@/lib/use-route" app components lib hooks` → no matches.

### Step 4: Delete the dead hook module

Delete `lib/use-route.ts`.

**Verify**: `pnpm exec tsc --noEmit` → exit 0 except the known `calendar.tsx`
error. `pnpm lint` → exit 0.

## Test plan

No automated suite. Verification is the typecheck + lint + the two greps above.
Optional smoke check: `pnpm dev`, open `/dashboard`, confirm routes still render
(no behavior changed — types are structurally identical).

## Done criteria

ALL must hold:

- [ ] `lib/route-types.ts` exists with the five route types.
- [ ] `lib/use-route.ts` no longer exists.
- [ ] `grep -rn "@/lib/use-route"` → no matches.
- [ ] `grep -rn "useRoute(" app components lib hooks` → no matches.
- [ ] `pnpm exec tsc --noEmit` exits 0 (except known `calendar.tsx` error); `pnpm lint` exits 0.
- [ ] `plans/README.md` 002 row updated.

## STOP conditions

- Step 1 finds a real call site of `useRoute(` → the hook is not dead; report.
- The drift check shows any in-scope file changed since `7d9801a` and the
  excerpts no longer match.
- Typecheck surfaces a NEW error beyond `calendar.tsx` after Step 4 — likely a
  missed import; re-run the grep, don't suppress with `any`.

## Maintenance notes

- After this, `lib/route-types.ts` is the single home for route shapes; the
  `/api/route` handler's response must stay structurally compatible with `Route`.
- Plan 003 edits `lib/use-fleet-routes.ts` next; it assumes the import already
  points at `@/lib/route-types`.
