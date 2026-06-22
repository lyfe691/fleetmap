import { describe, it, expect } from "vitest"
import { splitRoute } from "@/lib/route-slice"
import type { RouteGeometry } from "@/lib/route-types"

// Straight north-south line along lng=0, lat 0→3
// Each degree of latitude ≈ 111 km
const LINE: RouteGeometry = {
  type: "LineString",
  coordinates: [
    [0, 0],
    [0, 1],
    [0, 2],
    [0, 3],
  ],
}

describe("splitRoute", () => {
  it("at start: position [0,0], prev=null → traveled null, remaining == full geometry, location 0", () => {
    const result = splitRoute(LINE, [0, 0], null)
    expect(result.traveled).toBeNull()
    expect(result.remaining).toEqual(LINE)
    expect(result.location).toBe(0)
  })

  it("midway: position near [0,1.5], prev=null → traveled non-null, remaining non-null, location > 0", () => {
    const result = splitRoute(LINE, [0, 1.5], null)
    expect(result.traveled).not.toBeNull()
    expect(result.remaining).not.toBeNull()
    expect(result.location).toBeGreaterThan(0)
  })

  it("forward-clamp rejects backward: position behind prev.location → returns prev unchanged", () => {
    // First advance to ~1.5 degrees along the line
    const mid = splitRoute(LINE, [0, 1.5], null)
    expect(mid.location).toBeGreaterThan(0)

    // Now project a position BEHIND the current boundary
    const result = splitRoute(LINE, [0, 0.5], mid)
    expect(result).toBe(mid) // identical reference
  })

  it("forward-clamp rejects teleport: position > MAX_FORWARD_KM (2 km) ahead → returns prev unchanged", () => {
    // Start at beginning of line (location ~0)
    const start = splitRoute(LINE, [0, 0.001], null)

    // Jump 5 degrees north ≈ 555 km — well beyond the 2 km max
    const result = splitRoute(LINE, [0, 5], start)
    expect(result).toBe(start) // held, not advanced
  })

  it("forward move accepted: small step ahead (< 2 km) → location advances", () => {
    // A small step: 0.005 degrees ≈ 0.55 km
    const step1 = splitRoute(LINE, [0, 0.5], null)
    const step2 = splitRoute(LINE, [0, 0.505], step1)
    expect(step2.location).toBeGreaterThan(step1.location)
    expect(step2).not.toBe(step1)
  })

  it("degenerate: single-coordinate geometry → traveled null, remaining geometry, location 0", () => {
    const singlePt: RouteGeometry = {
      type: "LineString",
      coordinates: [[0, 0]],
    }
    const result = splitRoute(singlePt, [0, 0], null)
    expect(result.traveled).toBeNull()
    expect(result.remaining).toEqual(singlePt)
    expect(result.location).toBe(0)
  })
})
