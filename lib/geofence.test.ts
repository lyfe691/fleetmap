import { describe, it, expect } from "vitest"
import { haversineMeters, decideTransition } from "@/lib/geofence"

describe("haversineMeters", () => {
  it("same point → 0 metres", () => {
    expect(haversineMeters(47.3769, 8.5417, 47.3769, 8.5417)).toBe(0)
  })

  it("Zürich to Bern ≈ 95–100 km", () => {
    // Zürich: 47.3769°N 8.5417°E, Bern: 46.9481°N 7.4474°E
    const d = haversineMeters(47.3769, 8.5417, 46.9481, 7.4474)
    expect(d).toBeGreaterThan(90_000)
    expect(d).toBeLessThan(110_000)
  })

  it("1 degree of latitude north ≈ 111 km", () => {
    const d = haversineMeters(0, 0, 1, 0)
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it("short distance (50 m) is accurate within 2 m", () => {
    // Move ~50 m north: 50 / 111_000 degrees
    const deltaLat = 50 / 111_000
    const d = haversineMeters(0, 0, deltaLat, 0)
    expect(d).toBeGreaterThan(48)
    expect(d).toBeLessThan(52)
  })
})

describe("decideTransition", () => {
  // Default radii: ARRIVE=60m, DEPART=120m (from env or fallback)
  // We test against the documented defaults (60 / 120). Tests use env-default values.

  it("planned + inside ARRIVE radius (60 m) → 'arrived'", () => {
    expect(decideTransition("planned", 59)).toBe("arrived")
  })

  it("planned + exactly at ARRIVE radius → 'arrived'", () => {
    expect(decideTransition("planned", 60)).toBe("arrived")
  })

  it("planned + outside ARRIVE radius → null (hysteresis hold)", () => {
    expect(decideTransition("planned", 61)).toBeNull()
  })

  it("arrived + outside DEPART radius (120 m) → 'completed'", () => {
    expect(decideTransition("arrived", 121)).toBe("completed")
  })

  it("arrived + inside DEPART radius → null (hysteresis hold)", () => {
    expect(decideTransition("arrived", 120)).toBeNull()
  })

  it("completed stop → null regardless of distance", () => {
    expect(decideTransition("completed", 0)).toBeNull()
    expect(decideTransition("completed", 200)).toBeNull()
  })

  it("cancelled stop → null", () => {
    expect(decideTransition("cancelled", 0)).toBeNull()
  })
})
