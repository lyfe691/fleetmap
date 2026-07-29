/**
 * Driver session exchange — trades a Bubble Box rider JWT for a Supabase
 * session, so drivers only ever log in to the Bubble Box app (spec:
 * docs/specs/2026-07-13-driver-auth-federation-design.md, "2026-07-22
 * review" for the hosting shape).
 *
 * Run with:  pnpm driver-session   (listens on DRIVER_SESSION_PORT, 3100)
 *
 * This service is the sanctioned holder of the Supabase secret key outside
 * scripts/ (CLAUDE.md security conventions): internal-only in the prod
 * stack, fronted by a single Caddy route — never part of the Next app image.
 *
 * Flow: verify the BB RS256 token (rider tokens only — fleet/staff tokens
 * verify against the same key but are rejected) → map rider id to
 * vehicles.rider_ref → use the assigned driver user, or auto-provision one
 * on first login (no password, RLS principal only) → mint a Supabase
 * session and return it. The app then talks to POST /api/location exactly
 * as a password-authenticated driver would.
 */
import { createServer } from "node:http"
import { createClient } from "@supabase/supabase-js"
import {
  NotARiderTokenError,
  TokenInvalidError,
  verifyRiderToken,
} from "../lib/driver-auth/verify"
import { exchangeRiderToken, type ExchangeDeps } from "../lib/driver-auth/exchange"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY
const PUBLIC_KEY_B64 = process.env.BB_DRIVER_JWT_PUBLIC_KEY_B64
const PORT = Number(process.env.DRIVER_SESSION_PORT ?? 3100)
const MAX_BODY_BYTES = 16_384

if (!SUPABASE_URL || !SECRET_KEY || !PUBLIC_KEY_B64) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "BB_DRIVER_JWT_PUBLIC_KEY_B64 (base64-encoded PEM)."
  )
}

const publicKeyPem = Buffer.from(PUBLIC_KEY_B64, "base64").toString("utf8")

// Admin client: service-key PostgREST + auth admin. Never let a user session
// attach to this client — verifyOtp runs on a throwaway client instead, or
// every later .from() call would silently run as that driver.
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  })
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

function driverEmail(riderId: string): string {
  return `rider-${riderId}@driver.fleetmap.internal`
}

async function findVehicle(
  riderId: string
): Promise<{ id: string; assigned_user_id: string | null } | null> {
  const { data, error } = await admin
    .from("vehicles")
    .select("id, assigned_user_id")
    .eq("rider_ref", riderId)
    .maybeSingle()
  if (error) throw new Error(`vehicle lookup failed: ${error.message}`)
  return data
}

// First federated login for a van the sync already knows: create the driver
// user (no password — it exists only as an RLS principal) and claim the
// vehicle. Deterministic email makes retries after a partial failure land on
// the same user.
async function ensureDriverUser(
  vehicleId: string,
  riderId: string
): Promise<{ userId: string; email: string }> {
  const email = driverEmail(riderId)
  let userId: string
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })
  if (!error) {
    userId = data.user.id
  } else {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    })
    if (listErr) throw listErr
    const existing = list.users.find((u) => u.email === email)
    if (!existing) throw error
    userId = existing.id
  }
  const { error: updErr } = await admin
    .from("vehicles")
    .update({ assigned_user_id: userId })
    .eq("id", vehicleId)
  if (updErr) throw new Error(`vehicle claim failed: ${updErr.message}`)
  return { userId, email }
}

async function mintSession(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw new Error(`generateLink failed: ${error.message}`)
  const tokenHash = data.properties?.hashed_token
  if (!tokenHash) throw new Error("generateLink returned no hashed_token")

  const bare = createClient(SUPABASE_URL!, SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: verified, error: vErr } = await bare.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  })
  if (vErr) throw new Error(`verifyOtp failed: ${vErr.message}`)
  if (!verified.session) throw new Error("verifyOtp returned no session")
  return verified.session
}

const deps: ExchangeDeps = {
  verifyToken: (token) => verifyRiderToken(token, publicKeyPem),
  isTokenRejection: (err) =>
    err instanceof TokenInvalidError || err instanceof NotARiderTokenError,
  findVehicle,
  emailForUser: async (userId) => {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error) throw new Error(`user lookup failed: ${error.message}`)
    if (!data.user.email) throw new Error("assigned driver user has no email")
    return data.user.email
  },
  provisionDriver: async (vehicleId, riderId) =>
    (await ensureDriverUser(vehicleId, riderId)).email,
  mintSession,
  log,
}

const server = createServer((req, res) => {
  const respond = (status: number, body: Record<string, unknown>) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }

  if (req.method !== "POST") {
    return respond(405, { error: "POST only" })
  }

  let body = ""
  let overflow = false
  req.on("data", (chunk: Buffer) => {
    body += chunk
    if (body.length > MAX_BODY_BYTES) overflow = true
  })
  req.on("end", () => {
    if (overflow) return respond(413, { error: "body too large" })
    let token: unknown
    try {
      token = (JSON.parse(body) as { token?: unknown }).token
    } catch {
      return respond(400, { error: "invalid json body" })
    }
    if (typeof token !== "string" || token.length === 0) {
      return respond(400, { error: "token (string) is required" })
    }
    exchangeRiderToken(token, deps)
      .then((r) => respond(r.status, r.body))
      .catch((err) => {
        log("error", "exchange_failed", {
          error: err instanceof Error ? err.message : String(err),
        })
        respond(500, { error: "exchange failed" })
      })
  })
})

server.listen(PORT, () => {
  log("info", "startup", { port: PORT, supabase: SUPABASE_URL })
})
