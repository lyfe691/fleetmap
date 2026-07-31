import { spawn } from "node:child_process"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const tsxCli = require.resolve("tsx/cli")
const scriptPath = fileURLToPath(
  new URL("./prove-driver-session.ts", import.meta.url)
)

type RunningServer = {
  url: string
  close: () => Promise<void>
}

const runningServers: RunningServer[] = []

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
): Promise<RunningServer> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind a TCP port")
  }

  const running = {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  }
  runningServers.push(running)
  return running
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

async function requestJson(
  req: IncomingMessage
): Promise<Record<string, unknown>> {
  let text = ""
  req.setEncoding("utf8")
  for await (const chunk of req) text += chunk
  return JSON.parse(text) as Record<string, unknown>
}

function jwt(email: string, subject: string, marker: string) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      aud: "authenticated",
      email,
      exp: 4_102_444_800,
      role: "authenticated",
      sub: subject,
      marker,
    }),
    "local-signature",
  ].join(".")
}

function user(email: string, id: string) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: "2026-07-31T00:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    is_anonymous: false,
  }
}

async function runCli(input: {
  bubbleboxUrl: string
  exchangeUrl: string
  locationUrl: string
  supabaseUrl: string
  fleetAuthToken: string
}) {
  const child = spawn(
    process.execPath,
    [tsxCli, scriptPath, "42", "47.3769", "8.5417"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BB_API_URL: input.bubbleboxUrl,
        BB_API_USERNAME: "local-fleet-user",
        BB_API_PASSWORD: "local-fleet-password",
        NEXT_PUBLIC_SUPABASE_URL: input.supabaseUrl,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
        DRIVER_SESSION_PROOF_URL: input.exchangeUrl,
        DRIVER_SESSION_LOCATION_URL: input.locationUrl,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  )

  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk
  })
  child.stdin.end(`${input.fleetAuthToken}\n`)

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  return { code, stdout, stderr }
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close()))
})

describe("prove-driver-session CLI", () => {
  it("refreshes the exchanged session and uses only the refreshed identity for GPS", async () => {
    const fleetAuthToken = "piped-fleet-auth-secret"
    const initialAccessToken = jwt(
      "rider-42@driver.fleetmap.internal",
      "local-user-id",
      "initial"
    )
    const initialRefreshToken = "initial-refresh-secret"
    const refreshedAccessToken = jwt(
      "rider-42@driver.fleetmap.internal",
      "local-user-id",
      "refreshed"
    )
    const refreshedRefreshToken = "refreshed-refresh-secret"
    const proofUser = user("rider-42@driver.fleetmap.internal", "local-user-id")

    let bubbleboxSawToken = false
    let exchangeSawToken = false
    let refreshSawInitialToken = false
    let locationUsedRefreshedToken = false
    const userAuthorizations: string[] = []

    const bubblebox = await startServer(async (req, res) => {
      if (req.url === "/api/v2/fleet/authentication-token") {
        json(res, 200, { data: { loginToken: "local-fleet-login-token" } })
        return
      }
      if (req.url === "/api/v2/fleet/verify-rider-token") {
        const body = await requestJson(req)
        bubbleboxSawToken = body.riderAuthToken === fleetAuthToken
        json(res, 200, { id: 42, fullName: "Local Proof Rider" })
        return
      }
      json(res, 404, { error: "unexpected test path" })
    })

    const exchange = await startServer(async (req, res) => {
      const body = await requestJson(req)
      exchangeSawToken = body.token === fleetAuthToken
      json(res, 200, {
        access_token: initialAccessToken,
        refresh_token: initialRefreshToken,
        expires_in: 3600,
        token_type: "bearer",
      })
    })

    const supabase = await startServer(async (req, res) => {
      if (req.url === "/auth/v1/user" && req.method === "GET") {
        userAuthorizations.push(String(req.headers.authorization))
        json(res, 200, proofUser)
        return
      }
      if (
        req.url === "/auth/v1/token?grant_type=refresh_token" &&
        req.method === "POST"
      ) {
        const body = await requestJson(req)
        refreshSawInitialToken = body.refresh_token === initialRefreshToken
        json(res, 200, {
          access_token: refreshedAccessToken,
          refresh_token: refreshedRefreshToken,
          expires_in: 3600,
          token_type: "bearer",
          user: proofUser,
        })
        return
      }
      json(res, 404, { error: "unexpected test path" })
    })

    const location = await startServer(async (req, res) => {
      await requestJson(req)
      locationUsedRefreshedToken =
        req.headers.authorization === `Bearer ${refreshedAccessToken}`
      json(res, 200, { ok: true })
    })

    const result = await runCli({
      bubbleboxUrl: bubblebox.url,
      exchangeUrl: exchange.url,
      locationUrl: location.url,
      supabaseUrl: supabase.url,
      fleetAuthToken,
    })
    const output = `${result.stdout}\n${result.stderr}`

    expect(result.code).toBe(0)
    expect(bubbleboxSawToken).toBe(true)
    expect(exchangeSawToken).toBe(true)
    expect(refreshSawInitialToken).toBe(true)
    expect(userAuthorizations).toHaveLength(2)
    expect(userAuthorizations[0] === `Bearer ${initialAccessToken}`).toBe(true)
    expect(userAuthorizations[1] === `Bearer ${refreshedAccessToken}`).toBe(
      true
    )
    expect(locationUsedRefreshedToken).toBe(true)
    expect(output).toContain(
      "PASS: refreshed session and authenticated GPS write"
    )
    for (const token of [
      fleetAuthToken,
      "local-fleet-login-token",
      initialAccessToken,
      initialRefreshToken,
      refreshedAccessToken,
      refreshedRefreshToken,
    ]) {
      expect(output).not.toContain(token)
    }
  })
})
