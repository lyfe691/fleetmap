import { createServer, request as httpRequest, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import {
  createDriverSessionHandler,
  type DriverSessionHttpDeps,
} from "./http"

type TestServer = {
  baseUrl: string
  close: () => Promise<void>
  exchangeCalls: string[]
  logs: Array<{ level: string; event: string; fields?: Record<string, unknown> }>
  port: number
}

async function startServer(
  exchangeToken: DriverSessionHttpDeps["exchangeToken"] = async () => ({
    status: 200,
    body: { session: "minted" },
  })
): Promise<TestServer> {
  const exchangeCalls: string[] = []
  const logs: TestServer["logs"] = []
  const server = createServer(
    createDriverSessionHandler({
      exchangeToken: (token) => {
        exchangeCalls.push(token)
        return exchangeToken(token)
      },
      log: (level, event, fields) => logs.push({ level, event, fields }),
    })
  )

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    },
    exchangeCalls,
    logs,
    port,
  }
}

function openStreamingRequest(port: number): {
  request: ReturnType<typeof httpRequest>
  responsePromise: Promise<IncomingMessage>
} {
  const request = httpRequest({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/",
  })
  const responsePromise = new Promise<IncomingMessage>((resolve, reject) => {
    request.once("response", (response) => {
      response.resume()
      resolve(response)
    })
    request.once("error", reject)
  })

  return { request, responsePromise }
}

describe("createDriverSessionHandler", () => {
  it("answers preflight with CORS", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl, { method: "OPTIONS" })
      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("access-control-allow-headers")).toBe(
        "Content-Type"
      )
    } finally {
      await testServer.close()
    }
  })

  it("returns liveness without invoking exchange", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(testServer.exchangeCalls).toEqual([])
    } finally {
      await testServer.close()
    }
  })

  it("passes a token to the exchange and never permits caching", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl, {
        method: "POST",
        body: JSON.stringify({ token: "fresh-token" }),
      })
      expect(testServer.exchangeCalls).toEqual(["fresh-token"])
      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("pragma")).toBe("no-cache")
    } finally {
      await testServer.close()
    }
  })

  it("measures the 16 KiB limit in bytes", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl, {
        method: "POST",
        body: JSON.stringify({ token: "\u00fc".repeat(8_192) }),
      })
      expect(response.status).toBe(413)
      expect(testServer.exchangeCalls).toEqual([])
    } finally {
      await testServer.close()
    }
  })

  it("answers 413 on the first overflowing chunk without waiting for end", async () => {
    const testServer = await startServer()
    try {
      const { request, responsePromise } = openStreamingRequest(testServer.port)
      request.write(Buffer.alloc(16_385))
      const response = await responsePromise
      expect(response.statusCode).toBe(413)
      request.destroy()
    } finally {
      await testServer.close()
    }
  })

  it("rejects malformed JSON with a non-cacheable CORS response", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl, { method: "POST", body: "{" })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "invalid json body" })
      expect(response.headers.get("access-control-allow-origin")).toBe("*")
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.get("pragma")).toBe("no-cache")
    } finally {
      await testServer.close()
    }
  })

  it("rejects a missing token", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl, {
        method: "POST",
        body: JSON.stringify({}),
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: "token (string) is required" })
    } finally {
      await testServer.close()
    }
  })

  it("rejects unsupported methods", async () => {
    const testServer = await startServer()
    try {
      const response = await fetch(testServer.baseUrl, { method: "PATCH" })
      expect(response.status).toBe(405)
      expect(await response.json()).toEqual({ error: "POST only" })
    } finally {
      await testServer.close()
    }
  })

  it("passes the exchange result through unchanged", async () => {
    const testServer = await startServer(async () => ({
      status: 401,
      body: { error: "invalid token" },
    }))
    try {
      const response = await fetch(testServer.baseUrl, {
        method: "POST",
        body: JSON.stringify({ token: "rejected-token" }),
      })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "invalid token" })
    } finally {
      await testServer.close()
    }
  })

  it("hides thrown exchange errors without logging the submitted token", async () => {
    const submittedToken = "submitted-token-sentinel"
    const accessToken = "access-token-sentinel"
    const refreshToken = "refresh-token-sentinel"
    const testServer = await startServer(() => {
      throw new Error(
        `exchange failed for ${submittedToken}: access=${accessToken} refresh=${refreshToken}`
      )
    })
    try {
      const response = await fetch(testServer.baseUrl, {
        method: "POST",
        body: JSON.stringify({ token: submittedToken }),
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: "exchange failed" })
      const serializedLogs = JSON.stringify(testServer.logs)
      expect(serializedLogs).not.toContain(submittedToken)
      expect(serializedLogs).not.toContain(accessToken)
      expect(serializedLogs).not.toContain(refreshToken)
    } finally {
      await testServer.close()
    }
  })
})
