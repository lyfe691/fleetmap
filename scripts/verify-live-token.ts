/**
 * Test a real Bubble Box fleetAuthToken before it expires.
 *
 * The token lives 2 minutes, so there is no time to assemble a curl by hand.
 * This runs the actual production path (lib/bubblebox/client +
 * lib/driver-auth/verify) against the token, and optionally puts it through a
 * running driver-session too. Get a token from the rider app, or self-serve
 * one from the staging test rider:
 *
 *   pnpm --silent mint-fleet-auth-token | pnpm verify-live-token
 *   Get-Clipboard | pnpm verify-live-token
 *   Get-Clipboard | pnpm verify-live-token https://fleet.ysz.life/api/driver-session
 *   Get-Clipboard | pnpm verify-live-token http://localhost:3100
 *
 * Reads BB_API_URL / BB_API_USERNAME / BB_API_PASSWORD from .env.
 */
import { createBubbleboxClient } from "../lib/bubblebox/client"
import { summarizeExchangeBody } from "../lib/driver-auth/diagnostic"
import { TokenInvalidError, verifyRiderToken } from "../lib/driver-auth/verify"

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8")
  let text = ""
  for await (const chunk of process.stdin) {
    text += chunk
  }
  return text
}

const token = (await readStdin()).trim()
const exchangeUrl = process.argv[2]

if (!token) {
  console.error(
    "usage: Get-Clipboard | pnpm verify-live-token [driverSessionUrl]"
  )
  process.exit(1)
}

const { BB_API_URL, BB_API_USERNAME, BB_API_PASSWORD } = process.env
if (!BB_API_URL || !BB_API_USERNAME || !BB_API_PASSWORD) {
  console.error(
    "Missing BB_API_URL / BB_API_USERNAME / BB_API_PASSWORD in .env"
  )
  process.exit(1)
}

function secondsLeft(jwt: string): number | null {
  try {
    const claims = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64").toString("utf8")
    ) as { exp?: number }
    if (typeof claims.exp !== "number") return null
    return claims.exp - Math.floor(Date.now() / 1000)
  } catch {
    return null
  }
}

const left = secondsLeft(token)
if (left === null) {
  console.log("token: could not read exp (not a readable JWT payload)")
} else if (left <= 0) {
  console.log(
    `token: ALREADY EXPIRED ${-left}s ago — expect 403, get a fresh one`
  )
} else {
  console.log(`token: ${left}s of life left`)
}

const bb = createBubbleboxClient({
  baseUrl: BB_API_URL,
  username: BB_API_USERNAME,
  password: BB_API_PASSWORD,
})

console.log("\n[1] verify-rider-token using the configured fleet account")
const t0 = Date.now()
try {
  const { riderId } = await verifyRiderToken(token, bb)
  console.log(`    OK in ${Date.now() - t0}ms — rider id ${riderId}`)
  console.log("    => our fleet account IS authorized for this endpoint")
} catch (err) {
  console.log(`    FAILED in ${Date.now() - t0}ms`)
  if (err instanceof TokenInvalidError) {
    console.log(
      "    => 403. The fleetAuthToken may be invalid, expired, or from the\n" +
        "       wrong Bubble Box environment."
    )
  } else {
    console.log("    => verification failed outside the invalid-token case.")
  }
  process.exit(1)
}

if (!exchangeUrl) {
  console.log("\n[2] skipped (pass a driver-session URL as the first argument)")
  process.exit(0)
}

console.log(`\n[2] full exchange against ${exchangeUrl}`)
const t1 = Date.now()
const res = await fetch(exchangeUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token }),
})
const body = await res.text()
console.log(`    ${res.status} in ${Date.now() - t1}ms`)
const summary = summarizeExchangeBody(res.status, body)
console.log("   ", summary)
const sessionMinted =
  res.status === 200 &&
  "session" in summary &&
  summary.session.access_token === "present" &&
  summary.session.refresh_token === "present"
if (sessionMinted) {
  console.log("    => session minted. The whole chain works.")
} else if (res.status === 403) {
  console.log(
    "    => verified, but no vehicle has this rider_ref yet (ops task)."
  )
} else if (res.status === 401) {
  console.log("    => the token was rejected. See [1] for which side said no.")
}
if (!sessionMinted) {
  process.exit(1)
}
