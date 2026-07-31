import { describe, expect, it } from "vitest"
import { summarizeHealth } from "./health"

describe("summarizeHealth", () => {
  it("reports every configured service healthy", () => {
    expect(
      summarizeHealth({
        supabaseOk: true,
        osrmOk: true,
        driverSessionOk: true,
      })
    ).toEqual({
      ok: true,
      supabase: "ok",
      osrm: "ok",
      driver_session: "ok",
    })
  })

  it("does not gate health when driver-session is unconfigured", () => {
    expect(
      summarizeHealth({
        supabaseOk: true,
        osrmOk: true,
        driverSessionOk: null,
      })
    ).toEqual({
      ok: true,
      supabase: "ok",
      osrm: "ok",
      driver_session: null,
    })
  })

  it("gates health when driver-session is down", () => {
    expect(
      summarizeHealth({
        supabaseOk: true,
        osrmOk: true,
        driverSessionOk: false,
      })
    ).toEqual({
      ok: false,
      supabase: "ok",
      osrm: "ok",
      driver_session: "down",
    })
  })

  it("gates health when Supabase is down", () => {
    expect(
      summarizeHealth({
        supabaseOk: false,
        osrmOk: true,
        driverSessionOk: true,
      })
    ).toEqual({
      ok: false,
      supabase: "down",
      osrm: "ok",
      driver_session: "ok",
    })
  })

  it("gates health when OSRM is down", () => {
    expect(
      summarizeHealth({
        supabaseOk: true,
        osrmOk: false,
        driverSessionOk: true,
      })
    ).toEqual({
      ok: false,
      supabase: "ok",
      osrm: "down",
      driver_session: "ok",
    })
  })
})
