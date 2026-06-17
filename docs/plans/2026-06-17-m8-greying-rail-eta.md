# M8 — Traveled-vs-Remaining Greying + Fleet Side Rail + ETA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live TV "feel finished" — grey out the already-driven portion of each route, consolidate the per-vehicle lines into two shared sources, emphasize the next stop / fade completed ones, and add a fleet side rail with next-stop + ETA + freshness.

**Architecture:** A pure `splitRoute` helper (turf) projects each truck's live position onto its route line and cuts it into *traveled* (grey) and *remaining* (blue), with a per-vehicle **forward-only boundary clamp** so GPS jitter and laundry out-and-back self-intersections can't slide it backward. A `useFleetRoutes` hook fetches every active vehicle's route once per stop-set change (never on GPS pings) and returns them as one `Map`. `FleetMap` builds two shared `FeatureCollection` sources (traveled under, remaining over) from the splits, renders stop markers styled by next/active/terminal, and lays the map beside a fixed fleet side rail (layout B).

**Tech Stack:** Next.js App Router, React + `react-map-gl/maplibre`, `@turf/nearest-point-on-line` + `@turf/line-slice`, Supabase Realtime, OSRM behind the `/api/route` proxy.

## Global Constraints

- TypeScript throughout; `pnpm exec tsc --noEmit` is the gate (the pre-existing `components/ui/calendar.tsx` shadcn error is unrelated — ignore only that one).
- **No backend/schema/RLS/Realtime changes in M8.** Pure client-side: greying, sources, markers, rail. `/api/route` is unchanged (it already returns `legs[]`/`stopOffsets[]` from M7).
- **Geometry is fetched live, never stored**; re-fetch is gated on the stop set (`stopsKey`), never on position. OSRM stays behind the proxy.
- **PII boundary:** never read/render `address` or any customer field; the rail shows only `label`, stop type, ETA, counts, freshness.
- Exactly **two** new deps: `@turf/nearest-point-on-line`, `@turf/line-slice`. No others.
- Match each edited file's existing comment density; no gratuitous "gotcha" comments.
- Import alias `@/*` → project root. `esModuleInterop` is enabled, so turf default imports (`import lineSlice from "@turf/line-slice"`) are valid.

> **Verification convention:** no automated test suite (per CLAUDE.md). Gate = `tsc --noEmit` clean + the runnable acceptance shown per task. The marble-test of M8 is visual (greying advances as the fake-GPS truck drives its seeded route). Known harmless Git LF→CRLF warning on Windows commits.

> **Prereqs to run acceptance:** `docker compose up -d osrm`; `pnpm dev`; `pnpm fake-gps` (moving the seeded vehicle); stops seeded (`pnpm seed-stops`); display code entered on the TV.

> **Scope boundary:** auto-fit/auto-pan of the map to the fleet is intentionally **deferred** (constant recentering is poor for a monitoring TV; the Zürich initial view covers the demo fleet). Stop lifecycle / dispatcher mutations are **M9**.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `package.json` / lockfile | add the two `@turf/*` deps | **modify** |
| `lib/route-slice.ts` | pure `splitRoute(geometry, position, prev)` → `{ traveled, remaining, location }` with a forward-only boundary clamp | **create** |
| `lib/use-fleet-routes.ts` | fetch routes for all active vehicles, cache per vehicle by `stopsKey`, return `Map<vehicleId, Route>` | **create** |
| `components/map/fleet-map.tsx` | shared traveled/remaining sources from the splits; next/terminal stop marker styling; fleet side rail (layout B) | **modify (full rewrite)** |
| `CLAUDE.md` | Layout (`route-slice.ts`, `use-fleet-routes.ts`) + milestone M8 → done | **modify** |

---

## Task 1: turf deps + the `splitRoute` helper

**Files:**
- Modify: `package.json` (+ lockfile)
- Create: `lib/route-slice.ts`

**Interfaces:**
- Consumes: `RouteGeometry` (type) from `@/lib/use-route`; `@turf/nearest-point-on-line`, `@turf/line-slice`.
- Produces: `splitRoute(geometry: RouteGeometry, position: [number, number], prev: RouteSplit | null): RouteSplit` where `RouteSplit = { traveled: RouteGeometry | null; remaining: RouteGeometry; location: number }`. `location` is km-from-start of the boundary; it only advances (forward clamp). Pass `prev` for the SAME geometry to clamp; pass `null` when the geometry changed (resets the boundary).

- [ ] **Step 1: Install the deps**

Run: `pnpm add @turf/nearest-point-on-line @turf/line-slice`
Expected: both added to `package.json` `dependencies`; lockfile updated.

- [ ] **Step 2: Create `lib/route-slice.ts`**

```ts
import nearestPointOnLine from "@turf/nearest-point-on-line"
import lineSlice from "@turf/line-slice"
import type { RouteGeometry } from "@/lib/use-route"

// A truck can't move more than this far along its line between updates. A larger
// forward jump means GPS jitter or an out-and-back self-intersection snapping to
// the wrong limb — ignore it and hold the boundary. Heuristic, tunable; OSRM
// /match behind the proxy is the documented upgrade path.
const MAX_FORWARD_KM = 2

export type RouteSplit = {
  traveled: RouteGeometry | null
  remaining: RouteGeometry
  location: number // km along the line; monotonic forward per vehicle
}

/**
 * Project `position` onto `geometry` and cut it into the portion already driven
 * (traveled) and the portion left (remaining). The boundary only moves forward:
 * pass the previous split for the SAME geometry and a backward/teleporting snap
 * is rejected (boundary held). Pass `prev = null` when the geometry changed.
 */
export function splitRoute(
  geometry: RouteGeometry,
  position: [number, number],
  prev: RouteSplit | null
): RouteSplit {
  const snapped = nearestPointOnLine(geometry, position, { units: "kilometers" })
  const rawLoc = snapped.properties.location ?? 0

  if (prev) {
    const forward =
      rawLoc >= prev.location && rawLoc <= prev.location + MAX_FORWARD_KM
    if (!forward) return prev
  }

  const coords = geometry.coordinates
  if (rawLoc <= 0 || coords.length < 2) {
    return { traveled: null, remaining: geometry, location: 0 }
  }

  const snapPt = snapped.geometry.coordinates as [number, number]
  const traveled = lineSlice(coords[0], snapPt, geometry).geometry as RouteGeometry
  const remaining = lineSlice(snapPt, coords[coords.length - 1], geometry)
    .geometry as RouteGeometry
  return { traveled, remaining, location: rawLoc }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `components/ui/calendar.tsx` error. `route-slice.ts` must be error-free (turf default imports resolve under `esModuleInterop`; `RouteGeometry` is a type-only import so it does not pull the client module at runtime).

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml lib/route-slice.ts
git commit -m "feat(m8): splitRoute helper + turf deps — traveled/remaining with forward clamp"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: `useFleetRoutes` — fetch every active vehicle's route, cached by stop set

**Files:**
- Create: `lib/use-fleet-routes.ts`

**Interfaces:**
- Consumes: `GET /api/route?vehicleId=…` (M7); `getBrowserClient()`; `Route` (type) from `@/lib/use-route`.
- Produces: `useFleetRoutes(jobs: RouteJob[]): Map<string, Route>` where `RouteJob = { vehicleId: string; stopsKey: string }`. Fetches each job once and caches by `(vehicleId, stopsKey)`, so a route re-fetches only when that vehicle's stop set changes — never on GPS pings. Vehicles dropped from `jobs` are evicted. A `409`/error clears that vehicle's route.

- [ ] **Step 1: Create `lib/use-fleet-routes.ts`**

```ts
"use client"

import { useEffect, useRef, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"
import type { Route } from "@/lib/use-route"

export type RouteJob = { vehicleId: string; stopsKey: string }

async function fetchRoute(
  vehicleId: string,
  token: string
): Promise<Route | null> {
  const res = await fetch(
    `/api/route?vehicleId=${encodeURIComponent(vehicleId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  // 409 = idle (no position/stops); any non-ok = no line for this vehicle.
  if (!res.ok) return null
  return (await res.json()) as Route
}

/**
 * Fetches routes for many vehicles and caches each by its stopsKey, so a
 * vehicle's route re-fetches only when its stop set changes (not on GPS pings).
 * Returns a Map<vehicleId, Route> feeding the shared route sources + side rail
 * (legs[0].duration = ETA to the next stop). Drops vehicles absent from `jobs`.
 */
export function useFleetRoutes(jobs: RouteJob[]): Map<string, Route> {
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map())
  const cacheRef = useRef(new Map<string, { stopsKey: string; route: Route }>())

  // Stable primitive dep: re-run only when the set of (vehicle, stopSet) changes.
  const jobsKey = jobs
    .map((j) => `${j.vehicleId}@${j.stopsKey}`)
    .sort()
    .join(",")

  useEffect(() => {
    let cancelled = false

    const parsed: RouteJob[] = jobsKey
      ? jobsKey.split(",").map((entry) => {
          const at = entry.indexOf("@")
          return {
            vehicleId: entry.slice(0, at),
            stopsKey: entry.slice(at + 1),
          }
        })
      : []

    const run = async () => {
      const { data } = await getBrowserClient().auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      const cache = cacheRef.current
      const present = new Set(parsed.map((j) => j.vehicleId))
      for (const id of [...cache.keys()]) {
        if (!present.has(id)) cache.delete(id)
      }

      await Promise.all(
        parsed.map(async (j) => {
          const cached = cache.get(j.vehicleId)
          if (cached && cached.stopsKey === j.stopsKey) return
          const route = await fetchRoute(j.vehicleId, token)
          if (route) cache.set(j.vehicleId, { stopsKey: j.stopsKey, route })
          else cache.delete(j.vehicleId)
        })
      )

      if (cancelled) return
      setRoutes(new Map([...cache].map(([id, v]) => [id, v.route])))
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [jobsKey])

  return routes
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error. (`fleet-map.tsx` still uses the old single `useRoute` per child — it compiles until Task 3.)

- [ ] **Step 3: Commit**

```bash
git add lib/use-fleet-routes.ts
git commit -m "feat(m8): useFleetRoutes — per-vehicle route cache keyed by stop set"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 3: Greyed lines (shared sources) + marker emphasis + fleet side rail

**Files:**
- Modify (full rewrite): `components/map/fleet-map.tsx`

**Interfaces:**
- Consumes: `useLiveVehicles` (`{ vehicles, error, ready }`, `Vehicle`), `useLiveStops(ready)` (`stopsByVehicle`, `Stop`), `useFleetRoutes(jobs)` (`Map<vehicleId, Route>`, `RouteJob`), `splitRoute`/`RouteSplit`, `useNow`, `Route` (type).
- Produces: the finished TV view — map (flex-1) with two shared route sources (grey traveled under, blue remaining over) + status-styled stop markers, beside a fixed fleet side rail.

This rewrites the whole file. Versus the M7 version it: drops the per-vehicle `VehicleRoute` child + its `useRoute` import; adds `useFleetRoutes` + `splitRoute`; builds two shared `FeatureCollection` sources from per-vehicle splits (boundary held in a `progressRef`); renders ALL stops (next emphasized, active dot, terminal faded) instead of only active; wraps the map in a flex row with a `FleetRail`; reintroduces `formatEta` (for the rail). `FullscreenButton`, `useGlide`, `InterpolatedMarker`, `VehicleMarker` are unchanged from M7.

- [ ] **Step 1: Replace the file contents**

```tsx
"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import type { Feature, FeatureCollection } from "geojson"
import { MaximizeIcon, MinimizeIcon } from "lucide-react"
import { Layer, Map, Marker, Source } from "react-map-gl/maplibre"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { splitRoute, type RouteSplit } from "@/lib/route-slice"
import { useFleetRoutes, type RouteJob } from "@/lib/use-fleet-routes"
import { useLiveStops, type Stop } from "@/lib/use-live-stops"
import { useLiveVehicles, type Vehicle } from "@/lib/use-live-vehicles"
import { useNow } from "@/lib/use-now"
import type { Route, RouteGeometry } from "@/lib/use-route"

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`

// Drivers post ~every 5s; 30s of silence (6 missed) means stale/offline.
const STALE_AFTER_MS = 30_000

function isActive(s: Stop): boolean {
  return s.status === "planned" || s.status === "arrived"
}

function formatEta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 1) return "<1 min"
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function FleetMap({ displayCode }: { displayCode: string }) {
  const { vehicles, error, ready } = useLiveVehicles(displayCode)
  const { stopsByVehicle } = useLiveStops(ready)
  const now = useNow(5000)

  // One route job per vehicle with active stops; re-fetch keyed on the stop set.
  const jobs: RouteJob[] = useMemo(() => {
    const out: RouteJob[] = []
    for (const [vehicleId, stops] of stopsByVehicle) {
      const active = stops.filter(isActive)
      if (active.length === 0) continue
      out.push({
        vehicleId,
        stopsKey: active.map((s) => `${s.id}:${s.seq}:${s.status}`).join("|"),
      })
    }
    return out
  }, [stopsByVehicle])

  const routes = useFleetRoutes(jobs)

  // The lowest-seq active stop per vehicle (its "next stop").
  const nextStopIds = useMemo(() => {
    const ids = new Set<string>()
    for (const stops of stopsByVehicle.values()) {
      const next = stops.find(isActive) // hook returns each list sorted by seq
      if (next) ids.add(next.id)
    }
    return ids
  }, [stopsByVehicle])

  // Per-position traveled/remaining split, boundary held forward per vehicle.
  const progressRef = useRef(
    new Map<string, { split: RouteSplit; geometry: RouteGeometry }>()
  )
  const { remaining, traveled } = useMemo(() => {
    const prog = progressRef.current
    const remainingFeatures: Feature[] = []
    const traveledFeatures: Feature[] = []
    const seen = new Set<string>()
    for (const v of vehicles) {
      const route = routes.get(v.id)
      if (!route || v.last_lat == null || v.last_lng == null) continue
      seen.add(v.id)
      const prevEntry = prog.get(v.id)
      const prev =
        prevEntry && prevEntry.geometry === route.geometry
          ? prevEntry.split
          : null
      const split = splitRoute(route.geometry, [v.last_lng, v.last_lat], prev)
      prog.set(v.id, { split, geometry: route.geometry })
      remainingFeatures.push({
        type: "Feature",
        geometry: split.remaining,
        properties: { vehicle_id: v.id },
      })
      if (split.traveled) {
        traveledFeatures.push({
          type: "Feature",
          geometry: split.traveled,
          properties: { vehicle_id: v.id },
        })
      }
    }
    for (const id of [...prog.keys()]) if (!seen.has(id)) prog.delete(id)
    return {
      remaining: {
        type: "FeatureCollection",
        features: remainingFeatures,
      } as FeatureCollection,
      traveled: {
        type: "FeatureCollection",
        features: traveledFeatures,
      } as FeatureCollection,
    }
  }, [routes, vehicles])

  return (
    <div className="flex h-full w-full">
      <div className="relative h-full flex-1">
        {error ? (
          <Alert
            variant="destructive"
            className="absolute top-4 left-4 z-10 w-auto max-w-sm shadow-md"
          >
            <AlertDescription className="flex items-center gap-3">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearDisplayCode()
                  window.location.reload()
                }}
              >
                Change code
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <FullscreenButton />

        <Map
          initialViewState={{ longitude: 8.5417, latitude: 47.3769, zoom: 11 }}
          mapStyle={MAP_STYLE}
          style={{ width: "100%", height: "100%" }}
        >
          <Source id="routes-traveled" type="geojson" data={traveled}>
            <Layer
              id="routes-traveled-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#9ca3af",
                "line-width": 4,
                "line-opacity": 0.4,
              }}
            />
          </Source>

          <Source id="routes-remaining" type="geojson" data={remaining}>
            <Layer
              id="routes-remaining-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#2563eb",
                "line-width": 4,
                "line-opacity": 0.85,
              }}
            />
          </Source>

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

          {vehicles.map((v) =>
            v.last_lat != null && v.last_lng != null ? (
              <InterpolatedMarker
                key={v.id}
                longitude={v.last_lng}
                latitude={v.last_lat}
                anchor="center"
              >
                <VehicleMarker
                  heading={v.last_heading ?? 0}
                  label={v.label}
                  stale={
                    v.last_seen_at == null ||
                    now - new Date(v.last_seen_at).getTime() > STALE_AFTER_MS
                  }
                />
              </InterpolatedMarker>
            ) : null
          )}
        </Map>
      </div>

      <FleetRail
        vehicles={vehicles}
        stopsByVehicle={stopsByVehicle}
        routes={routes}
        now={now}
      />
    </div>
  )
}

function FleetRail({
  vehicles,
  stopsByVehicle,
  routes,
  now,
}: {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
}) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="border-b px-4 py-3 text-sm font-semibold">
        Fleet · {vehicles.length}
      </div>
      <ul className="flex-1 divide-y overflow-y-auto">
        {vehicles.map((v) => {
          const stops = stopsByVehicle.get(v.id) ?? []
          const active = stops.filter(isActive)
          const next = active[0] ?? null
          const eta = routes.get(v.id)?.legs[0]?.duration ?? null
          const stale =
            v.last_seen_at == null ||
            now - new Date(v.last_seen_at).getTime() > STALE_AFTER_MS
          const secondsAgo = v.last_seen_at
            ? Math.max(
                0,
                Math.round((now - new Date(v.last_seen_at).getTime()) / 1000)
              )
            : null
          return (
            <li key={v.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <StatusDot active={active.length > 0} stale={stale} />
                <span className="truncate text-sm font-medium">
                  {v.label ?? "Vehicle"}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {secondsAgo == null ? "—" : `${secondsAgo}s ago`}
                </span>
              </div>
              <div className="mt-1 pl-4 text-xs text-muted-foreground">
                {next ? (
                  <>
                    Next: {next.stop_type === "pickup" ? "Pickup" : "Dropoff"}
                    {eta != null ? (
                      <>
                        {" · "}
                        <span className="text-foreground">{formatEta(eta)}</span>
                      </>
                    ) : null}
                    {" · "}
                    {active.length} stop{active.length === 1 ? "" : "s"} left
                  </>
                ) : (
                  "Idle"
                )}
              </div>
            </li>
          )
        })}
        {vehicles.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            No vehicles
          </li>
        ) : null}
      </ul>
    </aside>
  )
}

function StatusDot({ active, stale }: { active: boolean; stale: boolean }) {
  const color = stale ? "#9ca3af" : active ? "#2563eb" : "#cbd5e1"
  return (
    <span
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}

function FullscreenButton() {
  const [fs, setFs] = useState(false)
  useEffect(() => {
    const onChange = () => setFs(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  return (
    <Button
      variant="secondary"
      size="icon"
      className="absolute right-4 bottom-4 z-10 shadow-md"
      aria-label={fs ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen()
      }}
    >
      {fs ? (
        <MinimizeIcon className="size-4" />
      ) : (
        <MaximizeIcon className="size-4" />
      )}
    </Button>
  )
}

// Tween the displayed position from where it is now toward each new target
// over ~one update window, so markers glide instead of teleporting.
function useGlide(targetLng: number, targetLat: number, durationMs: number) {
  const [pos, setPos] = useState({ lng: targetLng, lat: targetLat })
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const from = { ...posRef.current }
    const to = { lng: targetLng, lat: targetLat }
    if (Math.abs(to.lng - from.lng) + Math.abs(to.lat - from.lat) < 1e-7) {
      setPos(to)
      return
    }
    let raf = 0
    let start: number | null = null
    const step = (ts: number) => {
      start ??= ts
      const t = Math.min(1, (ts - start) / durationMs)
      setPos({
        lng: from.lng + (to.lng - from.lng) * t,
        lat: from.lat + (to.lat - from.lat) * t,
      })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [targetLng, targetLat, durationMs])

  return pos
}

function InterpolatedMarker({
  longitude,
  latitude,
  anchor,
  onClick,
  children,
}: {
  longitude: number
  latitude: number
  anchor?: ComponentProps<typeof Marker>["anchor"]
  onClick?: ComponentProps<typeof Marker>["onClick"]
  children: ReactNode
}) {
  const pos = useGlide(longitude, latitude, 5000)
  return (
    <Marker
      longitude={pos.lng}
      latitude={pos.lat}
      anchor={anchor}
      onClick={onClick}
    >
      {children}
    </Marker>
  )
}

function VehicleMarker({
  heading,
  label,
  stale,
}: {
  heading: number
  label: string | null
  stale: boolean
}) {
  const fill = stale ? "#9ca3af" : "#2563eb"
  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-0.5"
      style={{ opacity: stale ? 0.55 : 1 }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden
        style={{ transform: `rotate(${heading}deg)` }}
      >
        <path
          d="M12 2 L19 21 L12 17 L5 21 Z"
          fill={fill}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>
      {label ? (
        <span className="rounded bg-black/70 px-1 text-[10px] leading-tight text-white">
          {stale ? `${label} · stale` : label}
        </span>
      ) : null}
    </div>
  )
}

// pickup = green, dropoff = purple. Next stop emphasized (larger); terminal
// stops (completed/failed/skipped) faded.
function StopMarker({
  stopType,
  status,
  emphasized,
}: {
  stopType: "pickup" | "dropoff"
  status: string
  emphasized: boolean
}) {
  const terminal = status !== "planned" && status !== "arrived"
  const fill = stopType === "pickup" ? "#16a34a" : "#9333ea"
  const r = emphasized ? 9 : 6
  const size = (r + 3) * 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ opacity: terminal ? 0.35 : 1 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={fill}
        stroke="white"
        strokeWidth={emphasized ? 3 : 2}
      />
    </svg>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean except the known `components/ui/calendar.tsx` error. If `react-map-gl`'s `Source` `data` prop rejects the `FeatureCollection` (it should accept it — same `geojson` types), do NOT loosen with `any`; confirm the `import type { Feature, FeatureCollection } from "geojson"` is present and the feature `geometry` is the `RouteGeometry` from the split.

- [ ] **Step 3: End-to-end acceptance (OSRM + dev server + moving seeded vehicle)**

With `docker compose up -d osrm`, `pnpm dev`, `pnpm fake-gps`, stops seeded, open the dashboard.
Expected:
- Each active vehicle's route shows **blue ahead, grey behind** the truck. As the fake-GPS truck drives, the grey portion **grows** and the blue shrinks — the boundary tracks the truck and **never jumps backward** (watch through a pickup→return out-and-back stop pair: the grey doesn't snap to the wrong limb).
- The **next stop** (lowest-seq active) is a larger dot; other active stops are small dots. Mark one terminal in SQL (`update stops set status='completed' where seq=1;`) → it fades and drops from the line within a Realtime tick, and the next stop advances.
- The **side rail** lists every vehicle with a status dot (blue active / grey stale / slate idle), label, `Next: Pickup/Dropoff · <ETA> · N stops left`, and an `Xs ago` freshness badge that ticks up. Idle vehicles read "Idle".
- `/api/route` still fires on stop changes only (not per GPS ping) — confirm in the Network tab.

- [ ] **Step 4: Commit**

```bash
git add components/map/fleet-map.tsx
git commit -m "feat(m8): greyed traveled/remaining lines + next-stop emphasis + fleet side rail"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 4: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the two libs to the Layout block**

In the `## Layout` fenced block, after the line:
```
lib/use-live-stops.ts       dashboard stops live channel (snapshot + subscribe)
```
insert:
```
lib/use-fleet-routes.ts     per-vehicle route cache (fetch on stop-set change)
lib/route-slice.ts          traveled/remaining split (turf, forward-clamped)
```

- [ ] **Step 2: Mark M8 done in Milestones**

In the `## Milestones` list, insert immediately after the `- [x] **M7 …**` line and before `- Later:`:
```
- [x] **M8 — greying + side rail + ETA:** client-side traveled/remaining split (turf, forward-clamped), shared route sources, next-stop emphasis + terminal fade, fleet side rail (next stop · ETA · stops-left · freshness).
```
Leave the `- Later:` line unchanged.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(m8): record greying + side rail + ETA"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-review

- **Spec coverage (M8 row):** `@turf/nearest-point-on-line` + `@turf/line-slice` → Task 1 ✓; client-side split, clamped forward (out-and-back fix) → Task 1 `splitRoute` (forward-only `location` + `MAX_FORWARD_KM` window) ✓; shared remaining/traveled FeatureCollection sources → Task 3 (two sources, grey under / blue over) ✓; emphasize next-stop marker, fade terminal stops → Task 3 `StopMarker` + `nextStopIds` ✓; build fleet side rail (layout B) → Task 3 `FleetRail` (flex 1 map + `w-80` rail), rows show status dot, label, next stop type, ETA-to-next (`legs[0].duration`), stops-left, freshness ✓. The map-click/`setDest`/crosshair/`DestPin` were already removed in M7. Per-position re-slice with no OSRM call → split runs in a `useMemo` over `[routes, vehicles]`; OSRM only via `useFleetRoutes` on `stopsKey` change ✓.
- **Deferred (documented):** map auto-fit/auto-pan (poor for a monitoring TV); per-stop ETA windows beyond next; stop lifecycle / dispatcher mutations (M9).
- **Placeholder scan:** no TBD/TODO; every code step is complete; verification commands concrete.
- **Type/name consistency:** `RouteSplit`/`splitRoute` (Task 1) consumed by `fleet-map` (Task 3); `RouteJob`/`useFleetRoutes` (Task 2) consumed by `fleet-map` (Task 3); `Route`/`RouteGeometry` (M7 `use-route`) imported as types in Tasks 1–3; `Vehicle`/`Stop` come from the M7 hooks; `legs[0].duration` (rail ETA) matches the `/api/route` shape from M7. The `progressRef` resets `prev` to `null` on geometry-identity change, so `splitRoute`'s clamp only applies within one geometry.
- **Idempotency note:** the split `useMemo` mutates `progressRef` during render, but `location` is absolute (set to the snapped value, not incremented), so a React StrictMode double-invoke is idempotent — no boundary drift.
- **Constraints honored:** exactly two new deps; no schema/RLS/Realtime change; geometry fetched on stop-set change only (never on GPS); no PII rendered; matches existing file comment density.
```
