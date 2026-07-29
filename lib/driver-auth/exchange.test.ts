import { describe, expect, it } from "vitest"
import { exchangeRiderToken, type ExchangeDeps } from "./exchange"

class FakeRejection extends Error {}

const deps = (over: Partial<ExchangeDeps> = {}): ExchangeDeps => ({
  verifyToken: async () => ({ riderId: "6" }),
  isTokenRejection: (err) => err instanceof FakeRejection,
  findVehicle: async () => ({ id: "v1", assigned_user_id: "u1" }),
  emailForUser: async () => "rider-6@driver.fleetmap.internal",
  provisionDriver: async () => "rider-6@driver.fleetmap.internal",
  mintSession: async () => ({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: 1_900_000_000,
  }),
  log: () => {},
  ...over,
})

describe("exchangeRiderToken", () => {
  it("existing driver → 200 with exactly the four session fields", async () => {
    const result = await exchangeRiderToken("t", deps())
    expect(result.status).toBe(200)
    expect(Object.keys(result.body).sort()).toEqual([
      "access_token",
      "expires_at",
      "expires_in",
      "refresh_token",
    ])
  })

  it("a rejected token → 401 invalid token, and logs token_rejected", async () => {
    const events: Array<{ level: string; event: string; fields?: unknown }> = []
    const result = await exchangeRiderToken(
      "t",
      deps({
        verifyToken: async () => {
          throw new FakeRejection("bad sig")
        },
        log: (level, event, fields) => {
          events.push({ level, event, fields })
        },
      })
    )
    expect(result).toEqual({ status: 401, body: { error: "invalid token" } })
    expect(events.some((e) => e.event === "token_rejected")).toBe(true)
  })

  it("a non-rejection error from verifyToken propagates (does not become a 401)", async () => {
    await expect(
      exchangeRiderToken(
        "t",
        deps({
          verifyToken: async () => {
            throw new Error("boom")
          },
        })
      )
    ).rejects.toThrow(/boom/)
  })

  it("unmapped rider → 403 with the documented message, and logs unmapped_rider", async () => {
    const events: Array<{ level: string; event: string; fields?: unknown }> = []
    const result = await exchangeRiderToken(
      "t",
      deps({
        findVehicle: async () => null,
        log: (level, event, fields) => {
          events.push({ level, event, fields })
        },
      })
    )
    expect(result).toEqual({
      status: 403,
      body: { error: "no vehicle mapped for this rider" },
    })
    expect(events.some((e) => e.event === "unmapped_rider")).toBe(true)
  })

  it("vehicle without assigned_user_id → provisions, logs driver_autoprovisioned, still 200", async () => {
    const events: Array<{ level: string; event: string; fields?: unknown }> = []
    let provisioned: [string, string] | undefined
    const result = await exchangeRiderToken(
      "t",
      deps({
        findVehicle: async () => ({ id: "v1", assigned_user_id: null }),
        provisionDriver: async (vehicleId, riderId) => {
          provisioned = [vehicleId, riderId]
          return "rider-6@driver.fleetmap.internal"
        },
        log: (level, event, fields) => {
          events.push({ level, event, fields })
        },
      })
    )
    expect(provisioned).toEqual(["v1", "6"])
    expect(events.some((e) => e.event === "driver_autoprovisioned")).toBe(true)
    expect(result.status).toBe(200)
  })

  it("vehicle with assigned_user_id → uses emailForUser, never provisionDriver", async () => {
    let provisionCalled = false
    const result = await exchangeRiderToken(
      "t",
      deps({
        findVehicle: async () => ({ id: "v1", assigned_user_id: "u1" }),
        emailForUser: async () => "rider-6@driver.fleetmap.internal",
        provisionDriver: async () => {
          provisionCalled = true
          return "rider-6@driver.fleetmap.internal"
        },
      })
    )
    expect(provisionCalled).toBe(false)
    expect(result.status).toBe(200)
  })

  it("emailForUser throwing propagates, and mintSession is never called", async () => {
    let mintCalled = false
    await expect(
      exchangeRiderToken(
        "t",
        deps({
          emailForUser: async () => {
            throw new Error("user lookup failed: not found")
          },
          mintSession: async () => {
            mintCalled = true
            return {
              access_token: "at",
              refresh_token: "rt",
              expires_in: 3600,
              expires_at: 1_900_000_000,
            }
          },
        })
      )
    ).rejects.toThrow(/user lookup failed/)
    expect(mintCalled).toBe(false)
  })

  it("mints a session for the email resolved from the vehicle, not some other identity", async () => {
    let mintedFor: string | undefined
    await exchangeRiderToken(
      "t",
      deps({
        emailForUser: async () => "specific-driver@driver.fleetmap.internal",
        mintSession: async (email) => {
          mintedFor = email
          return {
            access_token: "at",
            refresh_token: "rt",
            expires_in: 3600,
            expires_at: 1_900_000_000,
          }
        },
      })
    )
    expect(mintedFor).toBe("specific-driver@driver.fleetmap.internal")
  })

  it("logs session_minted with { rider: \"6\" } on the happy path", async () => {
    const events: Array<{ level: string; event: string; fields?: unknown }> = []
    await exchangeRiderToken(
      "t",
      deps({
        log: (level, event, fields) => {
          events.push({ level, event, fields })
        },
      })
    )
    expect(events).toContainEqual({
      level: "info",
      event: "session_minted",
      fields: { rider: "6" },
    })
  })
})
