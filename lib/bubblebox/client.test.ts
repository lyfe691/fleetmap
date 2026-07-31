import { describe, expect, it } from "vitest"
import { createBubbleboxClient } from "./client"

const CONFIG = { baseUrl: "https://bb.example", username: "u", password: "p" }

type Call = { url: string; init?: RequestInit }

function fakeFetch(responses: Response[]) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (!next) throw new Error("fakeFetch: no queued response")
    return next
  }) as unknown as typeof fetch
  return { fn, calls }
}

const tokenOk = (token = "t1") =>
  new Response(JSON.stringify({ data: { loginToken: token } }), { status: 200 })

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })

describe("createBubbleboxClient", () => {
  it("mints on first call and sends the token in the accessToken header", async () => {
    const { fn, calls } = fakeFetch([tokenOk(), jsonOk({ ok: true })])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    await client.authedFetch("/api/v2/fleet/whatever")
    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe(
      "https://bb.example/api/v2/fleet/authentication-token"
    )
    expect(calls[1].url).toBe("https://bb.example/api/v2/fleet/whatever")
    expect((calls[1].init?.headers as Record<string, string>).accessToken).toBe(
      "t1"
    )
  })

  it("caches the token — a second authedFetch does not mint again", async () => {
    const { fn, calls } = fakeFetch([
      tokenOk(),
      jsonOk({ ok: true }),
      jsonOk({ ok: true }),
    ])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    await client.authedFetch("/api/v2/fleet/one")
    await client.authedFetch("/api/v2/fleet/two")
    expect(calls).toHaveLength(3)
    const mintCalls = calls.filter((c) => c.url.includes("authentication-token"))
    expect(mintCalls).toHaveLength(1)
  })

  it("re-mints once and retries on a 401, and the retry carries the new token", async () => {
    const { fn, calls } = fakeFetch([
      tokenOk("t1"),
      new Response("unauthorized", { status: 401 }),
      tokenOk("t2"),
      jsonOk({ ok: true }),
    ])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    const res = await client.authedFetch("/api/v2/fleet/thing")
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(4)
    expect((calls[3].init?.headers as Record<string, string>).accessToken).toBe(
      "t2"
    )
  })

  it("a second consecutive 401 is returned to the caller, not retried again", async () => {
    const { fn, calls } = fakeFetch([
      tokenOk("t1"),
      new Response("unauthorized", { status: 401 }),
      tokenOk("t2"),
      new Response("unauthorized", { status: 401 }),
    ])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    const res = await client.authedFetch("/api/v2/fleet/thing")
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(4)
  })

  it("a failed mint throws /BB token denied (500)/", async () => {
    const { fn } = fakeFetch([new Response("boom", { status: 500 })])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    await expect(client.authedFetch("/api/v2/fleet/thing")).rejects.toThrow(
      /BB token denied \(500\)/
    )
  })

  it("a mint response without data.loginToken throws /missing data.loginToken/", async () => {
    const { fn } = fakeFetch([new Response(JSON.stringify({ data: {} }), { status: 200 })])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    await expect(client.authedFetch("/api/v2/fleet/thing")).rejects.toThrow(
      /missing data.loginToken/
    )
  })

  it("fetchRiderRoutes requests both dueDate bounds and returns the parsed array", async () => {
    const routes = [{ rider: { id: 6, fullName: "Rider" } }]
    const { fn, calls } = fakeFetch([tokenOk(), jsonOk(routes)])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    const result = await client.fetchRiderRoutes("2026-07-08")
    expect(calls[1].url).toBe(
      "https://bb.example/api/v2/fleet/rider-routes" +
        "?dueDate[notEarlier]=2026-07-08&dueDate[notLater]=2026-07-08"
    )
    expect(result).toEqual(routes)
  })

  it("a non-ok routes response throws /BB routes fetch failed (503)/", async () => {
    const { fn } = fakeFetch([tokenOk(), new Response("down", { status: 503 })])
    const client = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    await expect(client.fetchRiderRoutes("2026-07-08")).rejects.toThrow(
      /BB routes fetch failed \(503\)/
    )
  })

  it("aborts a stalled token mint after the configured deadline", async () => {
    const hangingFetch: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("aborted")),
          { once: true }
        )
      })

    const client = createBubbleboxClient({
      baseUrl: "https://bb.test",
      username: "u",
      password: "p",
      fetchImpl: hangingFetch,
      timeoutMs: 10,
    })

    await expect(client.fetchRiderRoutes("2026-07-31")).rejects.toMatchObject({
      name: "TimeoutError",
    })
  }, 250)

  it("two clients built from the same config do not share a token (each mints its own)", async () => {
    const { fn, calls } = fakeFetch([
      tokenOk("t1"),
      jsonOk({ ok: true }),
      tokenOk("t2"),
      jsonOk({ ok: true }),
    ])
    const clientA = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    const clientB = createBubbleboxClient({ ...CONFIG, fetchImpl: fn })
    await clientA.authedFetch("/api/v2/fleet/thing")
    await clientB.authedFetch("/api/v2/fleet/thing")
    const mintCalls = calls.filter((c) => c.url.includes("authentication-token"))
    expect(mintCalls).toHaveLength(2)
  })
})
