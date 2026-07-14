import { describe, it, expect } from "vitest"
import {
  GRACE_MS,
  arrivalDelta,
  assessLateness,
  completedFloorFraction,
  remainingDriveSeconds,
  snapFraction,
} from "@/lib/schedule"
import type { Route } from "@/lib/route-types"
import type { Stop } from "@/lib/use-live-stops"

// Straight north-south line, three stops: A at the start, B midway, C at the
// end. Leg A→B takes 600 s, leg B→C 1200 s.
const ROUTE: Route = {
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [0, 0.5],
      [0, 1],
    ],
  },
  totalDuration: 1800,
  totalDistance: 111_000,
  legs: [
    { toStopId: "B", duration: 600, distance: 55_500 },
    { toStopId: "C", duration: 1200, distance: 55_500 },
  ],
  stopOffsets: [
    { stopId: "A", seq: 1, lineFraction: 0 },
    { stopId: "B", seq: 2, lineFraction: 0.5 },
    { stopId: "C", seq: 3, lineFraction: 1 },
  ],
  stops: [],
}

function makeStop(id: string, status: string, etaAt: string | null): Stop {
  return {
    id,
    vehicle_id: "v1",
    stop_type: "dropoff",
    seq: 1,
    lat: 0,
    lng: 0,
    status,
    eta_at: etaAt,
    completed_at: null,
  }
}

const NOW = 1_760_000_000_000

describe("snapFraction", () => {
  it("maps positions to 0 / ~0.5 / 1 along the line", () => {
    expect(snapFraction(ROUTE.geometry, [0, 0])).toBe(0)
    expect(snapFraction(ROUTE.geometry, [0, 0.5])).toBeCloseTo(0.5, 2)
    expect(snapFraction(ROUTE.geometry, [0, 1])).toBeCloseTo(1, 2)
  })
})

describe("remainingDriveSeconds", () => {
  it("first stop has no inbound leg → 0", () => {
    expect(remainingDriveSeconds(ROUTE, 0, "A")).toBe(0)
  })

  it("from the start: full legs count whole", () => {
    expect(remainingDriveSeconds(ROUTE, 0, "B")).toBe(600)
    expect(remainingDriveSeconds(ROUTE, 0, "C")).toBe(1800)
  })

  it("inside a leg: the current leg counts by its un-driven share", () => {
    // Halfway through leg A→B: 300 s of it left, plus all of B→C.
    expect(remainingDriveSeconds(ROUTE, 0.25, "C")).toBeCloseTo(1500)
    // Halfway through leg B→C: only 600 s left.
    expect(remainingDriveSeconds(ROUTE, 0.75, "C")).toBeCloseTo(600)
  })

  it("past the target → 0, not negative", () => {
    expect(remainingDriveSeconds(ROUTE, 0.75, "B")).toBe(0)
  })

  it("stop not on the route (stale payload) → null", () => {
    expect(remainingDriveSeconds(ROUTE, 0, "nope")).toBeNull()
  })
})

describe("assessLateness", () => {
  it("no active stop → not late", () => {
    const result = assessLateness({
      route: ROUTE,
      stops: [makeStop("A", "completed", null)],
      fraction: 0,
      now: NOW,
    })
    expect(result.late).toBe(false)
    expect(result.nextStopId).toBeNull()
  })

  it("never late without an eta_at to compare against", () => {
    const result = assessLateness({
      route: ROUTE,
      stops: [makeStop("C", "planned", null)],
      fraction: 0,
      now: NOW,
    })
    expect(result.late).toBe(false)
    expect(result.remainingDriveSec).toBe(1800)
  })

  it("projected arrival beyond eta + grace → late", () => {
    // 1800 s of driving left, but scheduled in 10 min.
    const eta = new Date(NOW + 10 * 60_000).toISOString()
    const result = assessLateness({
      route: ROUTE,
      stops: [makeStop("C", "planned", eta)],
      fraction: 0,
      now: NOW,
    })
    expect(result.late).toBe(true)
    expect(result.projectedArrivalMs).toBe(NOW + 1800 * 1000)
  })

  it("projected arrival within grace → not late", () => {
    // 1800 s left, scheduled in 28 min → 2 min over, inside the 5 min grace.
    const eta = new Date(NOW + 28 * 60_000).toISOString()
    const result = assessLateness({
      route: ROUTE,
      stops: [makeStop("C", "planned", eta)],
      fraction: 0,
      now: NOW,
    })
    expect(result.late).toBe(false)
  })

  it("degraded fallback (no route): late only once the scheduled time passed", () => {
    const pastEta = new Date(NOW - GRACE_MS - 60_000).toISOString()
    const futureEta = new Date(NOW + 60_000).toISOString()
    expect(
      assessLateness({
        route: undefined,
        stops: [makeStop("C", "planned", pastEta)],
        fraction: null,
        now: NOW,
      }).late
    ).toBe(true)
    expect(
      assessLateness({
        route: undefined,
        stops: [makeStop("C", "planned", futureEta)],
        fraction: null,
        now: NOW,
      }).late
    ).toBe(false)
  })
})

describe("arrivalDelta", () => {
  it("within grace either way → on time", () => {
    expect(arrivalDelta(NOW, NOW + 3 * 60_000)).toEqual({ kind: "onTime" })
    expect(arrivalDelta(NOW, NOW - 4 * 60_000)).toEqual({ kind: "onTime" })
  })

  it("beyond grace → late/early with rounded minutes", () => {
    expect(arrivalDelta(NOW, NOW + 9 * 60_000)).toEqual({
      kind: "late",
      minutes: 9,
    })
    expect(arrivalDelta(NOW, NOW - 8 * 60_000)).toEqual({
      kind: "early",
      minutes: 8,
    })
  })
})

describe("completedFloorFraction", () => {
  it("takes the farthest COMPLETED stop's offset, from live statuses", () => {
    const live = [
      makeStop("A", "completed", null),
      makeStop("B", "completed", null),
      makeStop("C", "planned", null),
    ]
    expect(completedFloorFraction(ROUTE, live)).toBe(0.5)
  })

  it("a cancelled/failed stop ahead does not drag the floor forward", () => {
    const live = [
      makeStop("A", "completed", null),
      makeStop("B", "planned", null),
      makeStop("C", "failed", null),
    ]
    expect(completedFloorFraction(ROUTE, live)).toBe(0)
  })

  it("no completed stops → 0", () => {
    expect(completedFloorFraction(ROUTE, [makeStop("C", "planned", null)])).toBe(0)
  })
})
