# M7 — Multi-Waypoint Route Proxy + Live Stops on the TV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TV draw each active vehicle's real, multi-stop delivery route from the seeded `stops` data — live, with zero clicks — and stop hitting OSRM on GPS pings.

**Architecture:** Generalize `GET /api/route` from "two caller-supplied points" to **`vehicleId`-only**: it resolves the vehicle's live position + its non-terminal stops server-side, makes one multi-waypoint OSRM call, and returns the line plus `legs[]`/`stopOffsets[]` (plumbing M8's ETA + grey boundary depend on). A new `useLiveStops` hook opens a second Realtime channel on `stops` (same dashboard session the vehicles hook already minted). `useRoute` is re-keyed to `(vehicleId, stopsKey)` so it re-fetches only when a vehicle's stop set changes — never on position. The map renders one route line per active vehicle via a small per-vehicle child component, plus simple stop markers.

**Tech Stack:** Next.js App Router route handlers (Node runtime), Supabase (Postgres + RLS + Realtime), `@supabase/supabase-js`, MapLibre GL via `react-map-gl/maplibre`, OSRM (self-hosted, behind the `/api/route` proxy).

## Global Constraints

- TypeScript throughout. Route handlers validate input and return `NextResponse.json` with explicit status codes (400 bad input, 401 no/invalid token, 409 no vehicle / no position / no active stops, 502 OSRM upstream, 404 OSRM "no route").
- **Auth + RLS is the security boundary.** Server reads run as the caller via `createUserClient(token)`; the dashboard claim policy gates which rows return.
- **OSRM stays internal** — only `/api/route` talks to it. Never the public OSM tile server.
- **Geometry is fetched live, never stored.** No route entity, no caching layer, no geometry over Realtime.
- **PII boundary:** never read or render `address` (or any customer field) from the live `stops` payload. The `stops_public` view (M6) already omits `address`; the snapshot uses it.
- **No new deps in M7.** `@turf/*` lands in M8. `fetch` is a Node/Next global (no import).
- No explanatory "gotcha" comments beyond the level already present in the files being edited; match each file's existing comment density.
- Import alias `@/*` → project root.

> **Verification convention:** this repo has **no automated test suite** (per CLAUDE.md). The gate for every task is `pnpm exec tsc --noEmit` (clean — except the known pre-existing `components/ui/calendar.tsx` error, which is unrelated shadcn UI) plus the runnable acceptance check shown in the task. There is also a known harmless Git LF→CRLF warning on Windows commits; ignore it.

> **Boundary note (deviation from the spec's milestone table):** the spec lists "remove the map-click/`setDest`/crosshair/`DestPin`" under M8. Because M7 changes `useRoute`'s signature, the dest-based call site **must** be removed in M7. So M7 removes the click-to-route interaction; M8 still owns the traveled-vs-remaining greying split, shared FeatureCollection sources, the fleet side rail, and next-stop marker emphasis.

> **Prereqs to run the acceptance checks:** `.env` populated; migration `0004` already applied (M6, done); dispatcher provisioned; `docker compose up -d osrm` (routing engine, dataset built — see `docker-compose.yml`); `pnpm dev` running; a vehicle exists and is moving (`pnpm fake-gps`); stops seeded (`pnpm seed-stops`). The dashboard display code is set on the TV.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `app/api/route/route.ts` | OSRM proxy: `vehicleId` → position + non-terminal stops → one multi-waypoint route; returns geometry + `legs[]` + `stopOffsets[]` + `stops[]` | **rewrite** |
| `lib/use-live-vehicles.ts` | Vehicles live channel; now also owns the shared dashboard session and exposes `ready` so a second channel can piggyback on it | **modify** (add `ready`) |
| `lib/use-live-stops.ts` | Second live channel: snapshot `stops_public` + subscribe to `stops`, grouped by `vehicle_id` | **create** |
| `lib/use-route.ts` | Fetch a vehicle's route, re-keyed to `(vehicleId, stopsKey)`; richer `Route` type | **rewrite** |
| `components/map/fleet-map.tsx` | Render one route line per active vehicle + stop markers; remove click-to-route/`setDest`/`DestPin`/crosshair/dest `RoutePanel` | **modify** |
| `CLAUDE.md` | Layout (`use-live-stops.ts`) + milestone M7 → done | **modify** |

---

## Task 1: Generalize `GET /api/route` to `vehicleId`-only (legs + stopOffsets)

**Files:**
- Rewrite: `app/api/route/route.ts`

**Interfaces:**
- Consumes: `createUserClient(token)` from `@/lib/supabase/server`; the `stops` table (M6); `OSRM_URL` env.
- Produces: `GET /api/route?vehicleId=<uuid>` →
  ```
  200 { geometry: LineString,
        totalDuration: number, totalDistance: number,
        legs: [{ toStopId: string, duration: number, distance: number }],
        stopOffsets: [{ stopId: string, seq: number, lineFraction: number }],
        stops: [{ id, seq, stop_type: 'pickup'|'dropoff', lat, lng, status }] }
  ```
  Error statuses: 401 (no/invalid token), 400 (no `vehicleId`), 409 (`no such vehicle` | `vehicle has no known position yet` | `vehicle has no active stops`), 502 (`routing upstream error` | `routing unavailable`), 404 (`no route (<code>)`), 500 (`db error`). `legs[j]` and `stops[j]` correspond (one OSRM leg per waypoint pair; waypoints are `[position, stop0, …, stopN-1]`, so leg `j` arrives at `stops[j]`).

- [ ] **Step 1: Replace the file contents**

```ts
import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// OSRM stays internal; the dashboard only ever talks to this proxy. Defaults to
// the local dev container; in compose this is the service name (http://osrm:5000).
const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000"

// Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500.
function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}

type StopRow = {
  id: string
  seq: number
  stop_type: "pickup" | "dropoff"
  lat: number
  lng: number
  status: string
}

// OSRM's route response, narrowed to what we proxy. One leg per waypoint pair.
type OsrmLeg = { duration: number; distance: number }
type OsrmRoute = {
  geometry: unknown
  duration: number
  distance: number
  legs?: OsrmLeg[]
}
type OsrmResponse = { code: string; routes?: OsrmRoute[] }

export async function GET(request: NextRequest) {
  // 1. Auth: a Bearer token is required (the dashboard session).
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicleId")
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 })
  }

  // Runs as the caller — the dashboard role's claim-scoped select policies let
  // it read any vehicle and its stops.
  const supabase = createUserClient(token)

  // 2. The vehicle's current position.
  const { data: vehicle, error: lookupError } = await supabase
    .from("vehicles")
    .select("last_lat, last_lng")
    .eq("id", vehicleId)
    .maybeSingle()
  if (lookupError) {
    if (isAuthError(lookupError)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/route] vehicle lookup failed:", lookupError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!vehicle) {
    return NextResponse.json({ error: "no such vehicle" }, { status: 409 })
  }
  if (vehicle.last_lat == null || vehicle.last_lng == null) {
    return NextResponse.json(
      { error: "vehicle has no known position yet" },
      { status: 409 }
    )
  }

  // 3. Non-terminal stops in visit order. seq is treated as the true visit
  // order (OSRM does not reorder waypoints).
  const { data: stopRows, error: stopsError } = await supabase
    .from("stops")
    .select("id, seq, stop_type, lat, lng, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
  if (stopsError) {
    if (isAuthError(stopsError)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/route] stops lookup failed:", stopsError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  const stops = (stopRows ?? []) as StopRow[]
  if (stops.length === 0) {
    return NextResponse.json(
      { error: "vehicle has no active stops" },
      { status: 409 }
    )
  }

  // 4. Proxy OSRM. Waypoints: live position, then each stop in seq order.
  // Coords are lng,lat (OSRM's order); full geojson geometry.
  const waypoints: [number, number][] = [
    [vehicle.last_lng, vehicle.last_lat],
    ...stops.map((s) => [s.lng, s.lat] as [number, number]),
  ]
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(";")
  const osrmUrl = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`

  let osrm: OsrmResponse
  try {
    const res = await fetch(osrmUrl)
    if (!res.ok) {
      console.error(`[/api/route] OSRM responded ${res.status}`)
      return NextResponse.json({ error: "routing upstream error" }, { status: 502 })
    }
    osrm = (await res.json()) as OsrmResponse
  } catch (err) {
    console.error("[/api/route] OSRM unreachable:", err)
    return NextResponse.json({ error: "routing unavailable" }, { status: 502 })
  }

  const best = osrm.routes?.[0]
  if (osrm.code !== "Ok" || !best) {
    // e.g. NoRoute / NoSegment — a valid OSRM answer, just no path.
    return NextResponse.json({ error: `no route (${osrm.code})` }, { status: 404 })
  }

  // 5. One leg per waypoint pair => leg j arrives at stops[j].
  const osrmLegs = best.legs ?? []
  const legs = stops.map((s, j) => ({
    toStopId: s.id,
    duration: osrmLegs[j]?.duration ?? 0,
    distance: osrmLegs[j]?.distance ?? 0,
  }))

  // 6. Each stop's fractional offset along the full line = cumulative leg
  // distance / total distance. M8's grey boundary clamps to these.
  const total = best.distance || 1
  let cumulative = 0
  const stopOffsets = stops.map((s, j) => {
    cumulative += osrmLegs[j]?.distance ?? 0
    return {
      stopId: s.id,
      seq: s.seq,
      lineFraction: Math.min(1, cumulative / total),
    }
  })

  return NextResponse.json({
    geometry: best.geometry,
    totalDuration: best.duration,
    totalDistance: best.distance,
    legs,
    stopOffsets,
    stops: stops.map((s) => ({
      id: s.id,
      seq: s.seq,
      stop_type: s.stop_type,
      lat: s.lat,
      lng: s.lng,
      status: s.status,
    })),
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors (only the known `components/ui/calendar.tsx` error). The old `parseCoord`, `destLat`/`destLng` are gone — confirm nothing else in the repo imports them (it doesn't; `useRoute` is the only caller and is updated in Task 3).

- [ ] **Step 3: Verify rejection + happy paths (dev server + OSRM + a seeded, positioned vehicle)**

Mint a dashboard token, then:
```bash
# no token -> 401
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/route"
# no vehicleId -> 400
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/route" -H "Authorization: Bearer $TOKEN"
# real vehicle with seeded stops -> 200 with geometry + legs + stopOffsets
curl -s "http://localhost:3000/api/route?vehicleId=$VEHICLE_ID" -H "Authorization: Bearer $TOKEN"
```
(`$TOKEN` from `POST /api/dashboard-session` with the display code; `$VEHICLE_ID` is the seeded vehicle.)
Expected: `401`, `400`, then JSON whose `legs.length === stops.length`, `stops` has 4 entries (the seeded SEED-001/002 stops, seq 1–4), and `stopOffsets[last].lineFraction` is ≈ `1`.

- [ ] **Step 4: Commit**

```bash
git add app/api/route/route.ts
git commit -m "feat(m7): generalize /api/route to vehicleId — multi-waypoint + legs/stopOffsets"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: `useLiveStops` hook + `ready` from `useLiveVehicles`

**Files:**
- Modify: `lib/use-live-vehicles.ts`
- Create: `lib/use-live-stops.ts`

**Interfaces:**
- Consumes: `getBrowserClient()` from `@/lib/supabase/browser`; the `stops_public` view + `stops` table (M6).
- Produces:
  - `useLiveVehicles(displayCode)` now returns `{ vehicles, error, ready }` where `ready: boolean` flips true once the shared session is minted + Realtime auth is armed (so a second channel can safely snapshot/subscribe on the same client).
  - `useLiveStops(ready: boolean)` → `{ stopsByVehicle: Map<string, Stop[]>, error }`; each list sorted by `seq`. `Stop = { id, vehicle_id, stop_type: 'pickup'|'dropoff', seq, lat, lng, status, eta_at }`.

> **Why `ready` instead of a second mint:** the browser client is a singleton; `useLiveVehicles` already mints the session, calls `realtime.setAuth`, and re-arms on `TOKEN_REFRESHED` (which is client-global, covering all channels). Minting a second session would create a second refresh-token lineage and can break the long-running kiosk under refresh-token rotation. So `useLiveStops` piggybacks on the same session, gated by `ready`.

- [ ] **Step 1: Add `ready` to `useLiveVehicles`**

In `lib/use-live-vehicles.ts`, add a `ready` state, reset it when the effect re-runs, set it true after the session + auth are armed, and return it.

Add the state (next to the existing `vehicles`/`error` state, after line `const [error, setError] = useState<string | null>(null)`):
```ts
  const [ready, setReady] = useState(false)
```

At the very top of the effect body, right after `if (!displayCode) return`, reset it:
```ts
    setReady(false)
```

In `start()`, immediately after `await supabase.realtime.setAuth(access_token)` and its following `if (cancelled) return`, mark ready before subscribing:
```ts
        if (cancelled) return
        setReady(true)
```
(So the block reads: `await supabase.auth.setSession(...)` → `await supabase.realtime.setAuth(access_token)` → `if (cancelled) return` → `setReady(true)` → `channel = supabase.channel("vehicles-live")…`.)

Change the return statement from `return { vehicles, error }` to:
```ts
  return { vehicles, error, ready }
```

- [ ] **Step 2: Create `lib/use-live-stops.ts`**

```ts
"use client"

import { useEffect, useState } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { getBrowserClient } from "@/lib/supabase/browser"

export type Stop = {
  id: string
  vehicle_id: string | null
  stop_type: "pickup" | "dropoff"
  seq: number
  lat: number
  lng: number
  status: string
  eta_at: string | null
}

const COLUMNS = "id, vehicle_id, stop_type, seq, lat, lng, status, eta_at"

/**
 * Second live channel for the dashboard: stops, on the SAME session the
 * vehicles hook minted. Gate on `ready` (vehicles hook has set the session +
 * armed realtime auth) so this only snapshots/subscribes once authed; the
 * vehicles hook's TOKEN_REFRESHED handler re-arms the shared socket for both
 * channels. Returns stops grouped by vehicle id, each list sorted by seq.
 */
export function useLiveStops(ready: boolean) {
  const [stopsByVehicle, setStopsByVehicle] = useState<Map<string, Stop[]>>(
    new Map()
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return

    const supabase = getBrowserClient()
    const byId = new Map<string, Stop>()
    let channel: RealtimeChannel | null = null
    let cancelled = false

    const publish = () => {
      if (cancelled) return
      const grouped = new Map<string, Stop[]>()
      for (const s of byId.values()) {
        if (s.vehicle_id == null) continue
        const list = grouped.get(s.vehicle_id) ?? []
        list.push(s)
        grouped.set(s.vehicle_id, list)
      }
      for (const list of grouped.values()) list.sort((a, b) => a.seq - b.seq)
      setStopsByVehicle(grouped)
    }

    const apply = (s: Stop, fromSnapshot = false) => {
      // Last-write-wins: the snapshot must not clobber a newer live event.
      if (fromSnapshot && byId.has(s.id)) return
      byId.set(s.id, s)
      publish()
    }

    const loadSnapshot = async () => {
      // Column-scoped view (0004): the snapshot never pulls address/order_id.
      const { data, error: selErr } = await supabase
        .from("stops_public")
        .select(COLUMNS)
      if (cancelled) return
      if (selErr) {
        setError(selErr.message)
        return
      }
      for (const s of (data ?? []) as Stop[]) apply(s, true)
    }

    channel = supabase
      .channel("stops-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stops" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            // REPLICA IDENTITY FULL (0004) puts the row in payload.old.
            const id = (payload.old as { id?: string }).id
            if (id) {
              byId.delete(id)
              publish()
            }
            return
          }
          apply(payload.new as Stop)
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadSnapshot()
      })

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [ready])

  return { stopsByVehicle, error }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: only the known `calendar.tsx` error. `useLiveVehicles` consumers still compile (the extra returned field is additive; `fleet-map.tsx` is updated in Task 4).

- [ ] **Step 4: Commit**

```bash
git add lib/use-live-vehicles.ts lib/use-live-stops.ts
git commit -m "feat(m7): useLiveStops — second realtime channel on the shared dashboard session"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 3: Re-key `useRoute` to `(vehicleId, stopsKey)`

**Files:**
- Rewrite: `lib/use-route.ts`

**Interfaces:**
- Consumes: `GET /api/route?vehicleId=…` (Task 1); `getBrowserClient()`.
- Produces: `useRoute(vehicleId: string | null, stopsKey: string | null)` → `{ route: Route | null, error, loading }`, where
  ```ts
  Route = {
    geometry: RouteGeometry              // { type:"LineString", coordinates:[number,number][] }
    totalDuration: number; totalDistance: number
    legs: RouteLeg[]                     // { toStopId, duration, distance }
    stopOffsets: StopOffset[]            // { stopId, seq, lineFraction }
    stops: RouteStop[]                   // { id, seq, stop_type, lat, lng, status }
  }
  ```
  Re-fetches only when `vehicleId` or `stopsKey` changes (never on position). A `409` clears the route without surfacing an error (idle vehicle).

- [ ] **Step 1: Replace the file contents**

```ts
"use client"

import { useEffect, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"

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

/**
 * Fetches a vehicle's driving route — current position through its non-terminal
 * stops, resolved server-side — via /api/route. Re-fetches only when the stop
 * set changes (`stopsKey`), NOT on GPS pings: the line is regenerated on stop
 * mutations; M8 slices it against the live position client-side. Clears (no
 * error) when the vehicle is idle (no vehicleId/stopsKey, or the request 409s).
 */
export function useRoute(vehicleId: string | null, stopsKey: string | null) {
  const [route, setRoute] = useState<Route | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vehicleId || !stopsKey) {
      setRoute(null)
      setError(null)
      return
    }

    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const { data } = await getBrowserClient().auth.getSession()
        const token = data.session?.access_token
        if (!token) throw new Error("no dashboard session")

        const res = await fetch(
          `/api/route?vehicleId=${encodeURIComponent(vehicleId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) {
          // 409 = no position yet / no active stops: idle, not an error.
          if (res.status === 409) {
            if (!cancelled) {
              setRoute(null)
              setError(null)
            }
            return
          }
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(body.error ?? `route failed (${res.status})`)
        }
        const json = (await res.json()) as Route
        if (!cancelled) {
          setRoute(json)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "route failed")
          setRoute(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [vehicleId, stopsKey])

  return { route, error, loading }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: this will report errors in `components/map/fleet-map.tsx` (it still calls the old `useRoute(selectedId, dest, positionKey)` and reads `route.duration`/`route.geometry`). That is expected — `fleet-map.tsx` is rewired in Task 4. The `lib/use-route.ts` file itself must be error-free. Confirm the only errors are in `fleet-map.tsx` (plus the known `calendar.tsx` one).

- [ ] **Step 3: Commit**

```bash
git add lib/use-route.ts
git commit -m "feat(m7): re-key useRoute to (vehicleId, stopsKey) — refetch on stop changes only"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

> Note: this commit leaves `fleet-map.tsx` temporarily not-compiling; Task 4 (the very next task) restores a clean typecheck. The two tasks are split because each is independently reviewable, but they should be implemented back-to-back.

---

## Task 4: Render fleet routes + stop markers; remove click-to-route

**Files:**
- Modify: `components/map/fleet-map.tsx`

**Interfaces:**
- Consumes: `useLiveVehicles` (`{ vehicles, error, ready }`), `useLiveStops(ready)` (`{ stopsByVehicle }`), `useRoute(vehicleId, stopsKey)` (`{ route }`), `useNow`.
- Produces: a TV that auto-draws one blue route line per active vehicle and a marker per non-terminal stop. No selection, no destination, no map-click routing.

This task **replaces the whole file**. It drops: `selectedId`/`selected`/`dest`/`setDest`/`clearRoute`, the `RoutePanel` component, the `DestPin` component, `formatEta`/`formatDistance` (they return in M8's rail), the `cursor`/`onClick` props on `<Map>`, the `useMemo` import, and the single `#route` source. It adds: a `VehicleRoute` child component (one `useRoute` call + one source/layer per vehicle — the React-idiomatic "hook per item"), `StopMarker`, and the `useLiveStops` wiring. `FullscreenButton`, `useGlide`, `InterpolatedMarker`, and `VehicleMarker` (minus its now-unused `selected` prop) are preserved.

- [ ] **Step 1: Replace the file contents**

```tsx
"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { MaximizeIcon, MinimizeIcon } from "lucide-react"
import { Layer, Map, Marker, Source } from "react-map-gl/maplibre"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { useLiveStops, type Stop } from "@/lib/use-live-stops"
import { useLiveVehicles } from "@/lib/use-live-vehicles"
import { useNow } from "@/lib/use-now"
import { useRoute } from "@/lib/use-route"

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`

// Drivers post ~every 5s; 30s of silence (6 missed) means stale/offline.
const STALE_AFTER_MS = 30_000

function isActive(s: Stop): boolean {
  return s.status === "planned" || s.status === "arrived"
}

export function FleetMap({ displayCode }: { displayCode: string }) {
  const { vehicles, error, ready } = useLiveVehicles(displayCode)
  const { stopsByVehicle } = useLiveStops(ready)
  const now = useNow(5000)

  return (
    <div className="relative h-full w-full">
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
        {Array.from(stopsByVehicle.entries()).map(([vehicleId, stops]) => {
          const active = stops.filter(isActive)
          if (active.length === 0) return null
          // Re-fetch only when the stop set changes (ids + seq + status).
          const stopsKey = active
            .map((s) => `${s.id}:${s.seq}:${s.status}`)
            .join("|")
          return (
            <VehicleRoute
              key={vehicleId}
              vehicleId={vehicleId}
              stopsKey={stopsKey}
            />
          )
        })}

        {Array.from(stopsByVehicle.values())
          .flat()
          .filter(isActive)
          .map((s) => (
            <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="bottom">
              <StopMarker stopType={s.stop_type} />
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
  )
}

// One useRoute call + one source/layer per active vehicle. A child component is
// how we call a hook per list item; M8 consolidates these into shared
// FeatureCollection sources and adds the traveled-vs-remaining split.
function VehicleRoute({
  vehicleId,
  stopsKey,
}: {
  vehicleId: string
  stopsKey: string
}) {
  const { route } = useRoute(vehicleId, stopsKey)
  if (!route) return null
  return (
    <Source
      id={`route-${vehicleId}`}
      type="geojson"
      data={{ type: "Feature", geometry: route.geometry, properties: {} }}
    >
      <Layer
        id={`route-line-${vehicleId}`}
        type="line"
        layout={{ "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-color": "#2563eb",
          "line-width": 4,
          "line-opacity": 0.85,
        }}
      />
    </Source>
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

// pickup = green, dropoff = purple. M8 emphasizes the next stop + fades terminal.
function StopMarker({ stopType }: { stopType: "pickup" | "dropoff" }) {
  const fill = stopType === "pickup" ? "#16a34a" : "#9333ea"
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="7" fill={fill} stroke="white" strokeWidth="2" />
    </svg>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean except the known `components/ui/calendar.tsx` error. (`InterpolatedMarker` keeps its optional `onClick` prop for parity even though no caller passes it now — that's fine.)

- [ ] **Step 3: End-to-end acceptance (OSRM + dev server + moving, seeded vehicle)**

With `docker compose up -d osrm`, `pnpm dev`, `pnpm fake-gps` (moving the seeded vehicle), and stops seeded (`pnpm seed-stops`), open the dashboard and enter the display code.
Expected:
- A blue line is drawn from the vehicle through its 4 stops (no clicks), with green pickup / purple dropoff dots at the stop locations.
- The line updates when the stop set changes: re-run `pnpm seed-stops` after editing a stop's coords, or mark a stop terminal in SQL (`update stops set status='completed' where seq=1;`) — the line shortens within a Realtime tick.
- The line does **not** re-fetch on every GPS ping: watch the dev-server log / browser Network tab — `/api/route?vehicleId=…` fires on stop changes only, not on each position update (which arrive ~every 5s).
- Idle vehicles (no non-terminal stops) draw no line; their marker still shows and glides.

- [ ] **Step 4: Commit**

```bash
git add components/map/fleet-map.tsx
git commit -m "feat(m7): draw live per-vehicle routes + stop markers; remove click-to-route"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 5: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the hook to the Layout block**

In the `## Layout` fenced block, after the line:
```
lib/supabase/browser.ts     browser client (publishable key) — dashboard read/Realtime
```
insert:
```
lib/use-live-stops.ts       dashboard stops live channel (snapshot + subscribe)
```

- [ ] **Step 2: Mark M7 done in Milestones**

In the `## Milestones` list, insert immediately after the `- [x] **M6 …**` line and before `- Later:`:
```
- [x] **M7 — live routes on the TV:** vehicleId-only `/api/route` (multi-waypoint + legs/stopOffsets), `useLiveStops` channel, per-vehicle route lines from real stop data; click-to-route removed.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(m7): record live route rendering on the TV"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Self-review

- **Spec coverage (M7 row):** generalize `/api/route` to `vehicleId`-only + `legs[]`/`stopOffsets[]`, drop `destLat/destLng`/`positionKey` → Task 1 ✓; `useLiveStops` hook → Task 2 ✓; re-key `useRoute` to `vehicleId` + `stopsKey`, re-fetch only on stop change → Task 3 ✓; "TV draws each active vehicle's multi-stop line from real seeded data, updating live as stop rows change; zero clicks; OSRM not hit on GPS pings" → Tasks 4 (render + acceptance) ✓. The spec's M8-listed click-removal is pulled into Task 4 (documented in the Boundary note) because the `useRoute` signature change forces it.
- **Deferred to M8 (correctly absent here):** `@turf/*`, the traveled-vs-remaining grey split + out-and-back clamp (uses `stopOffsets[]` produced in Task 1), shared remaining/traveled FeatureCollection sources w/ data-driven paint, the fleet side rail (layout B), next-stop marker emphasis + terminal fade, ETA-to-next in a panel (`formatEta(legs[0].duration)`).
- **Placeholder scan:** no TBD/TODO; every code step shows complete file/function bodies; all verification commands are concrete.
- **Type/name consistency:** the `/api/route` response (Task 1) — `geometry`, `totalDuration`, `totalDistance`, `legs[{toStopId,duration,distance}]`, `stopOffsets[{stopId,seq,lineFraction}]`, `stops[{id,seq,stop_type,lat,lng,status}]` — matches the `Route` type in `useRoute` (Task 3) field-for-field. `useLiveStops`'s `Stop` columns (Task 2) match `stops_public` (M6 view: `id, vehicle_id, stop_type, seq, lat, lng, status, eta_at`). `ready` is produced by `useLiveVehicles` (Task 2) and consumed by `useLiveStops`/`FleetMap` (Tasks 2/4). `stopsKey` is built in `FleetMap` (Task 4) and consumed by `useRoute` (Task 3). `isActive`/`StopMarker`/`VehicleRoute` are defined and used within Task 4 only.
- **Constraints honored:** no new deps; OSRM behind the proxy; geometry never stored; `address` never read from the live payload (snapshot uses `stops_public`); RLS via `createUserClient`; matches existing file comment density.
```
