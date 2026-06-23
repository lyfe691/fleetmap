import { describe, it, expect } from "vitest"
import { buildConsoleVehicles } from "@/lib/console/use-console-data"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"

// Minimal Vehicle fixture — only fields buildConsoleVehicles reads.
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
function makeStop(id: string, vehicleId: string): Stop {
  return {
    id,
    vehicle_id: vehicleId,
    stop_type: "dropoff",
    seq: 1,
    lat: 47.0,
    lng: 8.0,
    status: "planned",
    eta_at: null,
  }
}

// Minimal Route fixture.
function makeRoute(firstLegToStopId: string, duration: number): Route {
  return {
    geometry: { type: "LineString", coordinates: [[8.0, 47.0], [8.1, 47.1]] },
    totalDuration: duration,
    totalDistance: 1000,
    legs: [{ toStopId: firstLegToStopId, duration, distance: 1000 }],
    stopOffsets: [],
    stops: [],
  }
}

const VEHICLE_ID = "v1"
const STOP_ID = "s1"
const now = Date.now()

describe("buildConsoleVehicles — ETA freshness guard", () => {
  it("fresh route: legs[0].toStopId matches next stop → etaText formats the duration", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID)
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    const routes = new Map([[VEHICLE_ID, makeRoute(STOP_ID, 600)]])

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now })

    expect(cv.etaText).toBe("10 min")
  })

  it("stale route: legs[0].toStopId points at an old stop → etaText is '—', tone/statusLabel still onRoute/On Route", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID) // current next stop is s1
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    // Route's first leg still targets the OLD stop "s0"
    const routes = new Map([[VEHICLE_ID, makeRoute("s0", 600)]])

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now })

    expect(cv.etaText).toBe("—")
    expect(cv.tone).toBe("onRoute")
    expect(cv.statusLabel).toBe("On Route")
  })

  it("no route: vehicle has an active stop but no route entry → etaText is '—', routeTimer is '—'", () => {
    const vehicles = [makeVehicle(VEHICLE_ID)]
    const stop = makeStop(STOP_ID, VEHICLE_ID)
    const stopsByVehicle = new Map([[VEHICLE_ID, [stop]]])
    const routes = new Map<string, Route>() // no route

    const [cv] = buildConsoleVehicles({ vehicles, stopsByVehicle, routes, now })

    expect(cv.etaText).toBe("—")
    expect(cv.routeTimer).toBe("—")
  })
})
