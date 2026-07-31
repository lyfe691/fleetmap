/**
 * Human-gated production proof for a controlled rider mapping.
 *
 * Public argv contains only the expected rider id and approved coordinates:
 *
 *   Get-Clipboard | pnpm prove-driver-session <riderId> <lat> <lng>
 *
 * The fleetAuthToken is stdin-only. Exchanged and refreshed Supabase tokens
 * stay in process memory and are never included in output or errors.
 */
import { createClient, type User } from "@supabase/supabase-js"

import { createBubbleboxClient } from "../lib/bubblebox/client"
import { verifyRiderToken } from "../lib/driver-auth/verify"

const DEFAULT_EXCHANGE_URL = "https://fleet.ysz.life/api/driver-session"
const DEFAULT_LOCATION_URL = "https://fleet.ysz.life/api/location"

class ProofFailure extends Error {}

function stop(message: string): never {
  throw new ProofFailure(message)
}

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8")
  let text = ""
  for await (const chunk of process.stdin) {
    text += chunk
  }
  return text
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) stop(`missing required configuration: ${name}`)
  return value
}

function parseInputs() {
  const [riderId, latText, lngText, ...extra] = process.argv.slice(2)
  if (
    extra.length > 0 ||
    !riderId ||
    !/^\d+$/.test(riderId) ||
    !latText ||
    !lngText
  ) {
    stop(
      "usage: Get-Clipboard | pnpm prove-driver-session <riderId> <lat> <lng>"
    )
  }

  const lat = Number(latText)
  const lng = Number(lngText)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    stop("latitude must be a finite number in [-90, 90]")
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    stop("longitude must be a finite number in [-180, 180]")
  }

  return {
    riderId,
    expectedEmail: `rider-${riderId}@driver.fleetmap.internal`,
    lat,
    lng,
  }
}

function isExpectedUser(
  user: User | null,
  expectedEmail: string,
  expectedId?: string
) {
  return (
    user?.email === expectedEmail &&
    (expectedId === undefined || user.id === expectedId)
  )
}

async function runProof() {
  const { riderId, expectedEmail, lat, lng } = parseInputs()
  const fleetAuthToken = (await readStdin()).trim()
  if (!fleetAuthToken) {
    stop(
      "usage: Get-Clipboard | pnpm prove-driver-session <riderId> <lat> <lng>"
    )
  }

  const bubblebox = createBubbleboxClient({
    baseUrl: requiredEnv("BB_API_URL"),
    username: requiredEnv("BB_API_USERNAME"),
    password: requiredEnv("BB_API_PASSWORD"),
  })
  let verifiedRiderId: string
  try {
    verifiedRiderId = (await verifyRiderToken(fleetAuthToken, bubblebox))
      .riderId
  } catch {
    stop("Bubble Box did not verify the controlled proof rider")
  }
  if (verifiedRiderId !== riderId) {
    stop("Bubble Box verified a different rider; production proof stopped")
  }

  const exchangeUrl =
    process.env.DRIVER_SESSION_PROOF_URL ?? DEFAULT_EXCHANGE_URL
  let exchangeResponse: Response
  try {
    exchangeResponse = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: fleetAuthToken }),
    })
  } catch {
    stop("driver-session exchange request failed")
  }
  if (exchangeResponse.status !== 200) {
    stop(`driver-session exchange returned HTTP ${exchangeResponse.status}`)
  }

  let exchangeBody: unknown
  try {
    exchangeBody = await exchangeResponse.json()
  } catch {
    stop("driver-session exchange returned invalid JSON")
  }
  if (
    !exchangeBody ||
    typeof exchangeBody !== "object" ||
    Array.isArray(exchangeBody)
  ) {
    stop("driver-session exchange returned an invalid session")
  }
  const session = exchangeBody as Record<string, unknown>
  if (
    typeof session.access_token !== "string" ||
    session.access_token.length === 0 ||
    typeof session.refresh_token !== "string" ||
    session.refresh_token.length === 0
  ) {
    stop("driver-session exchange omitted a session token")
  }

  const supabase = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )

  const { data: setData, error: setError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (
    setError ||
    !setData.session ||
    !setData.user ||
    !isExpectedUser(setData.user, expectedEmail)
  ) {
    stop("Supabase setSession did not establish the expected rider identity")
  }
  const expectedUserId = setData.user.id

  const { data: refreshData, error: refreshError } =
    await supabase.auth.refreshSession()
  if (
    refreshError ||
    !refreshData.session?.access_token ||
    !refreshData.session.refresh_token ||
    !isExpectedUser(refreshData.user, expectedEmail, expectedUserId)
  ) {
    stop("Supabase refreshSession did not preserve the expected rider identity")
  }

  const refreshedAccessToken = refreshData.session.access_token
  const { data: identityData, error: identityError } =
    await supabase.auth.getUser(refreshedAccessToken)
  if (
    identityError ||
    !isExpectedUser(identityData.user, expectedEmail, expectedUserId)
  ) {
    stop("Supabase rejected the refreshed rider identity")
  }

  const recordedAt = new Date().toISOString()
  const locationUrl =
    process.env.DRIVER_SESSION_LOCATION_URL ?? DEFAULT_LOCATION_URL
  let locationResponse: Response
  try {
    locationResponse = await fetch(locationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshedAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lat,
        lng,
        heading: null,
        speed: 0,
        accuracy: 1,
        recorded_at: recordedAt,
      }),
    })
  } catch {
    stop("authenticated GPS request failed")
  }

  let locationBody: unknown
  try {
    locationBody = await locationResponse.json()
  } catch {
    stop(
      `location endpoint returned invalid JSON (HTTP ${locationResponse.status})`
    )
  }
  if (
    locationResponse.status !== 200 ||
    !locationBody ||
    typeof locationBody !== "object" ||
    Array.isArray(locationBody) ||
    (locationBody as Record<string, unknown>).ok !== true
  ) {
    stop(`authenticated GPS proof failed (HTTP ${locationResponse.status})`)
  }

  console.log("PASS: refreshed session and authenticated GPS write")
  console.log(`recorded_at: ${recordedAt}`)
}

try {
  await runProof()
} catch (error) {
  const message =
    error instanceof ProofFailure ? error.message : "unexpected proof failure"
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}
