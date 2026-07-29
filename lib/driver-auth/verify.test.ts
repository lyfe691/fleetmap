import { describe, expect, it } from "vitest"
import { TokenInvalidError, verifyRiderToken } from "./verify"

type Call = { path: string; init?: RequestInit }

function fakeClient(responder: () => Promise<Response> | Response) {
  const calls: Call[] = []
  return {
    calls,
    client: {
      authedFetch: async (path: string, init?: RequestInit) => {
        calls.push({ path, init })
        return responder()
      },
    },
  }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe("verifyRiderToken", () => {
  it("returns the rider id from a 200 as text", async () => {
    const { client } = fakeClient(() =>
      ok({ id: 6, fullName: "Rider Zurich City 1" })
    )
    expect(await verifyRiderToken("t", client)).toEqual({ riderId: "6" })
  })

  it("posts the token as riderAuthToken to the verify path", async () => {
    const { client, calls } = fakeClient(() => ok({ id: 6 }))
    await verifyRiderToken("the-rider-token", client)
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe("/api/v2/fleet/verify-rider-token")
    expect(calls[0].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      riderAuthToken: "the-rider-token",
    })
  })

  it("treats 403 as an invalid token (expiry is the common case)", async () => {
    const { client } = fakeClient(() => new Response("{}", { status: 403 }))
    await expect(verifyRiderToken("t", client)).rejects.toBeInstanceOf(
      TokenInvalidError
    )
  })

  it("does not treat 401 as an invalid token (that is our fleet credential failing)", async () => {
    const { client } = fakeClient(() => new Response("{}", { status: 401 }))
    const err = await verifyRiderToken("t", client).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(TokenInvalidError)
    expect(String(err.message)).toMatch(/401/)
  })

  it("does not treat a 500 from bubble box as an invalid token", async () => {
    const { client } = fakeClient(() => new Response("{}", { status: 500 }))
    const err = await verifyRiderToken("t", client).catch((e) => e)
    expect(err).not.toBeInstanceOf(TokenInvalidError)
  })

  it("does not treat a transport failure as an invalid token", async () => {
    const { client } = fakeClient(() => {
      throw new Error("ECONNREFUSED")
    })
    const err = await verifyRiderToken("t", client).catch((e) => e)
    expect(err).not.toBeInstanceOf(TokenInvalidError)
    expect(String(err.message)).toMatch(/ECONNREFUSED/)
  })

  it("rejects a 200 carrying no id (contract break, not a bad token)", async () => {
    const { client } = fakeClient(() => ok({ fullName: "no id here" }))
    const err = await verifyRiderToken("t", client).catch((e) => e)
    expect(err).not.toBeInstanceOf(TokenInvalidError)
    expect(String(err.message)).toMatch(/no integer id/)
  })

  it("rejects a non-integer id", async () => {
    const { client } = fakeClient(() => ok({ id: "6" }))
    await expect(verifyRiderToken("t", client)).rejects.toThrow(/no integer id/)
  })
})
