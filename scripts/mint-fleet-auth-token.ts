/**
 * Self-serve a fresh 2-minute fleetAuthToken from the staging test rider.
 *
 * Prints only the token to stdout so it pipes straight into the verifier:
 *
 *   pnpm --silent mint-fleet-auth-token | pnpm verify-live-token
 *   pnpm --silent mint-fleet-auth-token | pnpm verify-live-token http://localhost:3100
 *
 * Reads BB_API_URL / BB_TEST_RIDER_USERNAME / BB_TEST_RIDER_PASSWORD from .env.
 * The rider login lives under /shop, unlike the /api/v2 fleet endpoints.
 */
export {}

const { BB_API_URL, BB_TEST_RIDER_USERNAME, BB_TEST_RIDER_PASSWORD } =
  process.env
if (!BB_API_URL || !BB_TEST_RIDER_USERNAME || !BB_TEST_RIDER_PASSWORD) {
  console.error(
    "Missing BB_API_URL / BB_TEST_RIDER_USERNAME / BB_TEST_RIDER_PASSWORD in .env"
  )
  process.exit(1)
}

const login = await fetch(`${BB_API_URL}/shop/api/v1/en/security/check-login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: BB_TEST_RIDER_USERNAME,
    password: BB_TEST_RIDER_PASSWORD,
  }),
  signal: AbortSignal.timeout(15_000),
})
if (!login.ok) {
  console.error(`check-login failed (${login.status})`)
  process.exit(1)
}
const loginBody = (await login.json()) as { data?: { loginToken?: string } }
const loginToken = loginBody.data?.loginToken
if (!loginToken) {
  console.error("check-login response missing data.loginToken")
  process.exit(1)
}

const mint = await fetch(`${BB_API_URL}/api/v2/riders/fleet-auth-token`, {
  headers: { accessToken: loginToken },
  signal: AbortSignal.timeout(15_000),
})
if (!mint.ok) {
  console.error(`fleet-auth-token failed (${mint.status})`)
  process.exit(1)
}
const mintBody = (await mint.json()) as { data?: { fleetAuthToken?: string } }
const fleetAuthToken = mintBody.data?.fleetAuthToken
if (!fleetAuthToken) {
  console.error("fleet-auth-token response missing data.fleetAuthToken")
  process.exit(1)
}

console.log(fleetAuthToken)
