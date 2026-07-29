/**
 * Test a real Bubble Box riderAuthToken before it expires.
 *
 * The token lives 2 minutes and only the rider app can issue one, so there is
 * no time to assemble a curl by hand. This runs the actual production path
 * (lib/bubblebox/client + lib/driver-auth/verify) against the token, and
 * optionally puts it through a running driver-session too.
 *
 *   pnpm verify-live-token <riderAuthToken>
 *   pnpm verify-live-token <riderAuthToken> https://fleet.ysz.life/api/driver-session
 *   pnpm verify-live-token <riderAuthToken> http://localhost:3100
 *
 * Reads BB_API_URL / BB_API_USERNAME / BB_API_PASSWORD from .env.
 */
import { createBubbleboxClient } from "../lib/bubblebox/client"
import { TokenInvalidError, verifyRiderToken } from "../lib/driver-auth/verify"

const token = process.argv[2]
const exchangeUrl = process.argv[3]

if (!token) {
  console.error("usage: pnpm verify-live-token <riderAuthToken> [driverSessionUrl]")
  process.exit(1)
}

const { BB_API_URL, BB_API_USERNAME, BB_API_PASSWORD } = process.env
if (!BB_API_URL || !BB_API_USERNAME || !BB_API_PASSWORD) {
  console.error("Missing BB_API_URL / BB_API_USERNAME / BB_API_PASSWORD in .env")
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
  console.log(`token: ALREADY EXPIRED ${-left}s ago — expect 403, get a fresh one`)
} else {
  console.log(`token: ${left}s of life left`)
}

const bb = createBubbleboxClient({
  baseUrl: BB_API_URL,
  username: BB_API_USERNAME,
  password: BB_API_PASSWORD,
})

console.log(`\n[1] verify-rider-token, using OUR fleet account (${BB_API_USERNAME})`)
const t0 = Date.now()
try {
  const { riderId } = await verifyRiderToken(token, bb)
  console.log(`    OK in ${Date.now() - t0}ms — rider id ${riderId}`)
  console.log("    => our fleet account IS authorized for this endpoint")
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.log(`    FAILED in ${Date.now() - t0}ms — ${msg}`)
  if (err instanceof TokenInvalidError) {
    console.log(
      "    => 403. Either the token is expired/invalid, or our account is not\n" +
        "       authorized. If the token still had life left above, it is the account."
    )
  } else {
    console.log("    => not a token rejection. Our side or theirs is broken, see above.")
  }
}

if (!exchangeUrl) {
  console.log("\n[2] skipped (pass a driver-session URL as the second argument)")
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
console.log(`    ${body.slice(0, 400)}`)
if (res.ok) {
  console.log("    => session minted. The whole chain works.")
} else if (res.status === 403) {
  console.log("    => verified, but no vehicle has this rider_ref yet (ops task).")
} else if (res.status === 401) {
  console.log("    => the token was rejected. See [1] for which side said no.")
}
