import { describe, it, expect } from "vitest"
import { validate } from "@/lib/ingest-validate"

const VALID_STOP = {
  stop_type: "dropoff",
  seq: 1,
  lat: 47.3769,
  lng: 8.5417,
}

const VALID_ROUTE = {
  external_ref: "RT-001",
  stops: [VALID_STOP],
}

const VALID_BODY = { routes: [VALID_ROUTE] }

describe("validate", () => {
  it("valid payload → { routes }", () => {
    const result = validate(VALID_BODY)
    expect("routes" in result).toBe(true)
    if ("routes" in result) {
      expect(result.routes).toEqual(VALID_BODY.routes)
    }
  })

  it("null body → error", () => {
    expect("error" in validate(null)).toBe(true)
  })

  it("string body → error", () => {
    expect("error" in validate("not-an-object")).toBe(true)
  })

  it("empty routes array → error", () => {
    const result = validate({ routes: [] })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/non-empty/)
  })

  it("missing routes key → error", () => {
    expect("error" in validate({})).toBe(true)
  })

  it("missing external_ref → error", () => {
    const result = validate({ routes: [{ stops: [VALID_STOP] }] })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/external_ref/)
  })

  it("empty external_ref → error", () => {
    const result = validate({ routes: [{ external_ref: "", stops: [VALID_STOP] }] })
    expect("error" in result).toBe(true)
  })

  it("bad stop_type → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, stop_type: "delivery" }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/stop_type/)
  })

  it("non-integer seq → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, seq: 1.5 }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/seq/)
  })

  it("lat out of range (< -90) → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, lat: -91 }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/lat/)
  })

  it("lat out of range (> 90) → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, lat: 91 }] }],
    })
    expect("error" in result).toBe(true)
  })

  it("lng out of range (> 180) → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, lng: 181 }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/lng/)
  })

  it("non-UUID vehicle_id → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, vehicle_id: "not-a-uuid" }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/vehicle_id/)
  })

  it("valid UUID vehicle_id → ok", () => {
    const result = validate({
      routes: [
        {
          external_ref: "RT-001",
          stops: [{ ...VALID_STOP, vehicle_id: "550e8400-e29b-41d4-a716-446655440000" }],
        },
      ],
    })
    expect("routes" in result).toBe(true)
  })

  it("null vehicle_id (optional) → ok", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, vehicle_id: null }] }],
    })
    expect("routes" in result).toBe(true)
  })

  it("non-ISO eta_at → error", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, eta_at: "not-a-date" }] }],
    })
    expect("error" in result).toBe(true)
    if ("error" in result) expect(result.error).toMatch(/eta_at/)
  })

  it("valid ISO eta_at → ok", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, eta_at: "2026-06-22T10:00:00Z" }] }],
    })
    expect("routes" in result).toBe(true)
  })

  it("pickup stop_type → ok", () => {
    const result = validate({
      routes: [{ external_ref: "RT-001", stops: [{ ...VALID_STOP, stop_type: "pickup" }] }],
    })
    expect("routes" in result).toBe(true)
  })
})
