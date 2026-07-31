import type { IncomingMessage, RequestListener } from "node:http"
import type { ExchangeResult } from "./exchange"

const MAX_BODY_BYTES = 16_384

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  ...CORS_HEADERS,
}

export type DriverSessionHttpDeps = {
  exchangeToken: (token: string) => Promise<ExchangeResult>
  log: (
    level: "info" | "warn" | "error",
    event: string,
    fields?: Record<string, unknown>
  ) => void
}

export function createDriverSessionHandler(
  deps: DriverSessionHttpDeps
): RequestListener {
  return (req, res) => {
    const respond = (status: number, body: Record<string, unknown>) => {
      res.writeHead(status, JSON_HEADERS)
      res.end(JSON.stringify(body))
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    if (req.method === "GET") {
      respond(200, { ok: true })
      return
    }

    if (req.method !== "POST") {
      respond(405, { error: "POST only" })
      return
    }

    handlePost(req, respond, deps)
  }
}

function handlePost(
  req: IncomingMessage,
  respond: (status: number, body: Record<string, unknown>) => void,
  deps: DriverSessionHttpDeps
): void {
  const chunks: Buffer[] = []
  let byteLength = 0
  let finished = false

  req.on("data", (chunk: Buffer) => {
    if (finished) return

    byteLength += chunk.length
    if (byteLength > MAX_BODY_BYTES) {
      finished = true
      respond(413, { error: "body too large" })
      return
    }

    chunks.push(chunk)
  })

  req.on("end", () => {
    if (finished) return
    finished = true

    let token: unknown
    try {
      token = (JSON.parse(Buffer.concat(chunks, byteLength).toString()) as {
        token?: unknown
      }).token
    } catch {
      respond(400, { error: "invalid json body" })
      return
    }

    if (typeof token !== "string" || token.length === 0) {
      respond(400, { error: "token (string) is required" })
      return
    }

    void Promise.resolve()
      .then(() => deps.exchangeToken(token))
      .then((result) => respond(result.status, result.body))
      .catch(() => {
        deps.log("error", "exchange_failed")
        respond(500, { error: "exchange failed" })
      })
  })

  req.on("error", () => {
    finished = true
  })
}
