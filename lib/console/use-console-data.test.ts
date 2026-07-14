import { describe, it, expect } from "vitest"
import { buildConsoleVehicles, type Translator } from "@/lib/console/use-console-data"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import { en } from "@/lib/i18n/en"

const t: Translator = (key, params) => {
  let s: string = en[key]
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

// Minimal Vehicle fixture — parked at the route's first stop.
function makeVehicle(id: string): Vehicle {
  return {
    id,
    label: id,
    status: "active",
    last_lat: 47.0,
    last_lng: 8.0,
    last_heading: null,
    last_speed: null,
    last_seen_at: new Date().toISOString(),
    area_id: null,
  }
}

// Minimal Stop fixture.
function makeStop(id: string, vehicleId: string, etaAt: string | null = null): Stop {
  return {
    id,
    vehicle_id: vehicleId,
    stop_type: "dropoff",
    seq: 2,
    lat: 47.1,
    lng: 8.0,
    status: "planned",
    eta_at: etaAt,
    completed_at: null,
  }
}

// Full-day route: s0 (done, at the start) → target stop at the end.
function makeRoute(toStopId: string, duration: number): Route {
  return {
    geometry: { type: "LineString", coordinates: [[8.0, 47.0], [8.0, 47.1]] },
    totalDuration: duration,
    totalDistance: 11000,
    legs: [{ toStopId, duration, distance: 11000 }],
    stopOffsets: [
      { stopId: "s0", seq: 1, lineFraction: 0 },
      { stopId: toStopId, seq: 2, lineFraction: 1 },
    ],
    stops: [],
  }
}

const VEHICLE_ID = "v1"
const STOP_ID = "s1"
const now = Date.now()

describe("buildConsoleVehicles — schedule-derived ETA", () => {
  it("fresh route: next stop is on the route → etaText formats the remaining drive", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID)
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    const routes = new Map([[VEHICLE_ID, makeRoute(STOP_ID, 600)]])

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now }, t)

    expect(cv.etaText).toBe("10 min")
    expect(cv.late).toBe(false)
  })

  it("stale route: next stop not on the route yet → etaText is '—', tone still onRoute", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID) // current next stop is s1
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    // Route still targets the OLD stop set (no s1 anywhere)
    const routes = new Map([[VEHICLE_ID, makeRoute("s-old", 600)]])

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now }, t)

    expect(cv.etaText).toBe("—")
    expect(cv.tone).toBe("onRoute")
    expect(cv.statusLabel).toBe("On Route")
  })

  it("no route: vehicle has an active stop but no route entry → etaText is '—', routeTimer is '—'", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID)
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    const routes = new Map<string, Route>() // no route

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now }, t)

    expect(cv.etaText).toBe("—")
    expect(cv.routeTimer).toBe("—")
  })

  it("late: projected arrival past eta_at + grace → late flag set", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    // 600 s of driving left but scheduled 1 min from now → ~9 min over grace.
    const stop = makeStop(STOP_ID, VEHICLE_ID, new Date(now + 60_000).toISOString())
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    const routes = new Map([[VEHICLE_ID, makeRoute(STOP_ID, 600)]])

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now }, t)

    expect(cv.late).toBe(true)
    expect(cv.nextStopProjectedMs).toBe(now + 600_000)
  })

  it("on time: projected arrival before eta_at → not late", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID, new Date(now + 20 * 60_000).toISOString())
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    const routes = new Map([[VEHICLE_ID, makeRoute(STOP_ID, 600)]])

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now }, t)

    expect(cv.late).toBe(false)
  })
})
