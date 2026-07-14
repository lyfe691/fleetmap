import { describe, it, expect } from "vitest"
import { computeRouteFeatures } from "@/lib/use-route-features"
import type { Route } from "@/lib/route-types"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"

const GEOM = {
  type: "LineString" as const,
  coordinates: [
    [8.5, 47.3] as [number, number],
    [8.5, 47.4] as [number, number],
    [8.5, 47.5] as [number, number],
  ],
}

const BASE_ROUTE: Route = {
  geometry: GEOM,
  totalDuration: 600,
  totalDistance: 22000,
  legs: [{ toStopId: "s2", duration: 600, distance: 22000 }],
  stopOffsets: [
    { stopId: "s1", seq: 1, lineFraction: 0 },
    { stopId: "s2", seq: 2, lineFraction: 1 },
  ],
  stops: [],
}

function makeVehicle(id: string, lat: number | null, lng: number | null): Vehicle {
  return {
    id,
    label: id,
    last_lat: lat,
    last_lng: lng,
    last_heading: 0,
    last_speed: null,
    last_seen_at: new Date().toISOString(),
    status: "active",
    area_id: null,
  } as Vehicle
}

function makeStop(id: string, status: string): Stop {
  return {
    id,
    vehicle_id: "v1",
    stop_type: "dropoff",
    seq: 1,
    lat: 47.3,
    lng: 8.5,
    status,
    eta_at: null,
    completed_at: null,
  }
}

const NO_STOPS = new Map<string, Stop[]>()
const NOT_LATE = new Set<string>()

describe("computeRouteFeatures", () => {
  it("returns one remaining feature for a located vehicle", () => {
    const prog = new Map()
    const routes = new Map([["v1", BASE_ROUTE]])
    const vehicles = [makeVehicle("v1", 47.35, 8.5)]
    const { remaining } = computeRouteFeatures(prog, routes, vehicles, NO_STOPS, NOT_LATE)
    expect(remaining.features).toHaveLength(1)
    expect(remaining.features[0].properties?.vehicle_id).toBe("v1")
    expect(remaining.features[0].properties?.late).toBe(false)
  })

  it("tags the remaining feature late when the vehicle is in lateIds", () => {
    const prog = new Map()
    const routes = new Map([["v1", BASE_ROUTE]])
    const vehicles = [makeVehicle("v1", 47.35, 8.5)]
    const { remaining } = computeRouteFeatures(
      prog,
      routes,
      vehicles,
      NO_STOPS,
      new Set(["v1"])
    )
    expect(remaining.features[0].properties?.late).toBe(true)
  })

  it("skips a vehicle with null last_lat", () => {
    const prog = new Map()
    const routes = new Map([["v1", BASE_ROUTE]])
    const vehicles = [makeVehicle("v1", null, null)]
    const { remaining } = computeRouteFeatures(prog, routes, vehicles, NO_STOPS, NOT_LATE)
    expect(remaining.features).toHaveLength(0)
  })

  it("skips a vehicle with no route", () => {
    const prog = new Map()
    const routes = new Map<string, Route>()
    const vehicles = [makeVehicle("v1", 47.35, 8.5)]
    const { remaining } = computeRouteFeatures(prog, routes, vehicles, NO_STOPS, NOT_LATE)
    expect(remaining.features).toHaveLength(0)
  })

  it("prunes a departed vehicle from prog", () => {
    const prog = new Map()
    const routes = new Map([["v1", BASE_ROUTE]])
    const vehicles = [makeVehicle("v1", 47.35, 8.5)]
    computeRouteFeatures(prog, routes, vehicles, NO_STOPS, NOT_LATE)
    expect(prog.has("v1")).toBe(true)
    computeRouteFeatures(prog, routes, [], NO_STOPS, NOT_LATE)
    expect(prog.has("v1")).toBe(false)
  })

  it("vehicle at start: traveled is null or empty, remaining non-null", () => {
    const prog = new Map()
    const routes = new Map([["v1", BASE_ROUTE]])
    const vehicles = [makeVehicle("v1", 47.3, 8.5)]
    const { remaining, traveled } = computeRouteFeatures(
      prog,
      routes,
      vehicles,
      NO_STOPS,
      NOT_LATE
    )
    expect(remaining.features).toHaveLength(1)
    expect(traveled.features).toHaveLength(0)
  })

  it("completed-stop floor greys the finished leg even with the van at the start", () => {
    const prog = new Map()
    const routes = new Map([["v1", BASE_ROUTE]])
    const vehicles = [makeVehicle("v1", 47.3, 8.5)]
    // s2 (at the line's end) completed → the whole line is done.
    const stops = new Map([["v1", [makeStop("s2", "completed")]]])
    const { traveled } = computeRouteFeatures(prog, routes, vehicles, stops, NOT_LATE)
    expect(traveled.features).toHaveLength(1)
    expect(traveled.features[0].geometry).toEqual(GEOM)
  })
})
