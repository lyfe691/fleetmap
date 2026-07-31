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
  new URL("./verify-live-token.ts", import.meta.url)
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

async function runCli(input: {
  bubbleboxUrl: string
  exchangeUrl: string
  fleetAuthToken: string
}) {
  const child = spawn(
    process.execPath,
    [tsxCli, scriptPath, input.exchangeUrl],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BB_API_URL: input.bubbleboxUrl,
        BB_API_USERNAME: "local-fleet-user",
        BB_API_PASSWORD: "local-fleet-password",
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

describe("verify-live-token CLI", () => {
  it.each([
    {
      name: "an exact 200 response carrying both tokens",
      status: 200,
      body: {
        access_token: "upstream-access-secret",
        refresh_token: "upstream-refresh-secret",
        expires_in: 3600,
      },
      succeeds: true,
    },
    {
      name: "a 200 response missing a refresh token",
      status: 200,
      body: { access_token: "upstream-access-secret", expires_in: 3600 },
      succeeds: false,
    },
    {
      name: "a non-200 success carrying both tokens",
      status: 201,
      body: {
        access_token: "upstream-access-secret",
        refresh_token: "upstream-refresh-secret",
        expires_in: 3600,
      },
      succeeds: false,
    },
  ])(
    "handles $name without leaking tokens",
    async ({ status, body, succeeds }) => {
      const fleetAuthToken = "piped-fleet-auth-secret"
      const bubblebox = await startServer(async (req, res) => {
        if (req.url === "/api/v2/fleet/authentication-token") {
          json(res, 200, { data: { loginToken: "local-fleet-login-token" } })
          return
        }
        if (req.url === "/api/v2/fleet/verify-rider-token") {
          const requestBody = await requestJson(req)
          if (requestBody.riderAuthToken !== fleetAuthToken) {
            json(res, 403, { error: "wrong piped token" })
            return
          }
          json(res, 200, { id: 42, fullName: "Local Proof Rider" })
          return
        }
        json(res, 404, { error: "unexpected test path" })
      })
      const exchange = await startServer((_req, res) => {
        json(res, status, body)
      })

      const result = await runCli({
        bubbleboxUrl: bubblebox.url,
        exchangeUrl: exchange.url,
        fleetAuthToken,
      })
      const output = `${result.stdout}\n${result.stderr}`

      if (succeeds) {
        expect(result.code).toBe(0)
      } else {
        expect(result.code).not.toBe(0)
      }
      expect(output).not.toContain(fleetAuthToken)
      expect(output).not.toContain("local-fleet-login-token")
      expect(output).not.toContain("local-fleet-password")
      expect(output).not.toContain("upstream-access-secret")
      expect(output).not.toContain("upstream-refresh-secret")
    }
  )
})
