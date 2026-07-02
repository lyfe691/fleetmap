import { describe, it, expect } from "vitest"
import { bearingDeg, positionAt, thinPoints, traceStats, type ReplayPoint } from "@/lib/replay"

const P = (lat: number, lng: number, tMs: number): ReplayPoint => ({ lat, lng, tMs })

describe("bearingDeg", () => {
  it("due north → 0°", () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 5)
  })
  it("due east → 90°", () => {
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5)
  })
  it("due south → 180°", () => {
    expect(bearingDeg(1, 0, 0, 0)).toBeCloseTo(180, 5)
  })
  it("due west → 270°", () => {
    expect(bearingDeg(0, 1, 0, 0)).toBeCloseTo(270, 5)
  })
})

describe("positionAt", () => {
  const track = [P(0, 0, 0), P(1, 0, 1000), P(1, 1, 2000)]

  it("empty track → null", () => {
    expect(positionAt([], 500)).toBeNull()
  })

  it("before the first fix → clamped to the start, bearing of the first segment", () => {
    const pos = positionAt(track, -100)
    expect(pos).toMatchObject({ lat: 0, lng: 0 })
    expect(pos?.bearing).toBeCloseTo(0, 5)
  })

  it("after the last fix → clamped to the end, bearing of the last segment", () => {
    const pos = positionAt(track, 99999)
    expect(pos).toMatchObject({ lat: 1, lng: 1 })
    expect(pos?.bearing).toBeCloseTo(90, 1)
  })

  it("midway through a segment → linear interpolation", () => {
    const pos = positionAt(track, 500)
    expect(pos?.lat).toBeCloseTo(0.5, 9)
    expect(pos?.lng).toBeCloseTo(0, 9)
  })

  it("exactly on a fix → that fix", () => {
    const pos = positionAt(track, 1000)
    expect(pos?.lat).toBeCloseTo(1, 9)
    expect(pos?.lng).toBeCloseTo(0, 9)
  })

  it("standing still (zero-length segment) → bearing null", () => {
    const still = [P(1, 1, 0), P(1, 1, 1000)]
    expect(positionAt(still, 500)?.bearing).toBeNull()
  })
})

describe("thinPoints", () => {
  it("under the cap → unchanged", () => {
    const pts = [P(0, 0, 0), P(1, 0, 1)]
    expect(thinPoints(pts, 10)).toBe(pts)
  })

  it("over the cap → at most max+1 points, last fix always kept", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => P(i, 0, i))
    const out = thinPoints(pts, 100)
    expect(out.length).toBeLessThanOrEqual(101)
    expect(out[0]).toBe(pts[0])
    expect(out[out.length - 1]).toBe(pts[pts.length - 1])
  })
})

describe("traceStats", () => {
  it("single point → zero distance and duration", () => {
    expect(traceStats([P(0, 0, 0)])).toEqual({ distanceM: 0, durationMs: 0 })
  })

  it("1° of latitude ≈ 111 km, duration = last - first", () => {
    const { distanceM, durationMs } = traceStats([P(0, 0, 0), P(1, 0, 60_000)])
    expect(distanceM).toBeGreaterThan(110_000)
    expect(distanceM).toBeLessThan(112_000)
    expect(durationMs).toBe(60_000)
  })
})
