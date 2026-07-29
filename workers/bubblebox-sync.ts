/**
 * Bubble Box route sync — mirrors their rider routes into orders/stops.
 *
 * Run with:  pnpm bb-sync   (the Next server must be reachable at
 *                            FLEETMAP_API_URL; dev default localhost:3000)
 *
 * Auth: dispatcher session only (ingest secret) — this process runs on the
 * VPS, so it never sees the Supabase secret key. Vehicles are read via
 * PostgREST as the dispatcher (select policy 0007).
 *
 * Bubble Box side: BB_API_URL + BB_API_USERNAME/BB_API_PASSWORD mint a 24 h
 * token (re-minted on 401) for GET /api/v2/fleet/rider-routes. There is no
 * slim status endpoint yet, so the full routes endpoint is fetched every tick
 * — it is the only status source. BB_FIXTURE_FILE feeds the fetch from a
 * local JSON (BBRoute[]) instead.
 */
import { readFileSync } from "node:fs"
import { buildSyncPayloads, type BBRoute } from "../lib/bubblebox/translate"
import { createBubbleboxClient } from "../lib/bubblebox/client"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const INGEST_SECRET = process.env.DISPATCHER_INGEST_SECRET
if (!SUPABASE_URL || !SUPABASE_KEY || !INGEST_SECRET) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, DISPATCHER_INGEST_SECRET."
  )
}

const API = process.env.FLEETMAP_API_URL ?? "http://localhost:3000"
const BB_API_URL = process.env.BB_API_URL
const BB_USERNAME = process.env.BB_API_USERNAME
const BB_PASSWORD = process.env.BB_API_PASSWORD
const FIXTURE = process.env.BB_FIXTURE_FILE
const SYNC_MS = Number(process.env.BB_SYNC_INTERVAL_MS ?? 60_000)

if (!FIXTURE && !(BB_API_URL && BB_USERNAME && BB_PASSWORD)) {
  throw new Error(
    "Set BB_API_URL + BB_API_USERNAME + BB_API_PASSWORD (real feed) " +
      "or BB_FIXTURE_FILE (dev)."
  )
}

const bb =
  BB_API_URL && BB_USERNAME && BB_PASSWORD
    ? createBubbleboxClient({
        baseUrl: BB_API_URL,
        username: BB_USERNAME,
        password: BB_PASSWORD,
      })
    : null

// Their day boundary is local Swiss time, not UTC.
function zurichToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(
    new Date()
  )
}

// One JSON line per event — grep-able in `docker logs`, shippable later.
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

// --- Fleetmap side -----------------------------------------------------------

class UnauthorizedError extends Error {}

let dispatcherToken: string | null = null

async function mintDispatcherToken(): Promise<string> {
  const res = await fetch(`${API}/api/dispatcher-session`, {
    method: "POST",
    headers: { "x-ingest-secret": INGEST_SECRET! },
  })
  if (!res.ok) throw new Error(`dispatcher-session denied (${res.status})`)
  const { access_token } = (await res.json()) as { access_token: string }
  return access_token
}

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  dispatcherToken ??= await mintDispatcherToken()
  try {
    return await fn(dispatcherToken)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      dispatcherToken = await mintDispatcherToken()
      return await fn(dispatcherToken)
    }
    throw err
  }
}

async function fetchRiderMap(token: string): Promise<Map<string, string>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?select=id,rider_ref&rider_ref=not.is.null`,
    { headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${token}` } }
  )
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) throw new Error(`vehicles read failed (${res.status})`)
  const rows = (await res.json()) as { id: string; rider_ref: string }[]
  return new Map(rows.map((r) => [r.rider_ref, r.id]))
}

async function putVehicleRoutes(
  token: string,
  vehicleId: string,
  orders: unknown[]
): Promise<void> {
  const res = await fetch(`${API}/api/ingest/vehicle-routes`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ vehicle_id: vehicleId, orders }),
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) {
    throw new Error(`sync PUT failed (${res.status}): ${await res.text()}`)
  }
}

// Heartbeat for GET /api/health (sync_state, 0013). Best-effort: a heartbeat
// failure must never fail the tick, and errors are kept alongside the last
// success rather than clearing it — the timestamps disambiguate.
async function writeHeartbeat(
  fields: Partial<{
    last_success_at: string
    last_error: string
    last_error_at: string
  }>
): Promise<void> {
  // last_error is served to the public internet via GET /api/health — cap it
  // so a verbose upstream error body can never ride along verbatim.
  const row = { id: "bubblebox-sync", ...fields }
  if (row.last_error) row.last_error = row.last_error.slice(0, 200)
  try {
    await withToken(async (token) => {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/sync_state?on_conflict=id`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY!,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify(row),
        }
      )
      if (res.status === 401) throw new UnauthorizedError()
      if (!res.ok) throw new Error(`heartbeat write failed (${res.status})`)
    })
  } catch (err) {
    log("warn", "heartbeat_failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function fetchStructure(date: string): Promise<BBRoute[]> {
  if (FIXTURE) {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as BBRoute[]
  }
  return bb!.fetchRiderRoutes(date)
}

// --- Loop --------------------------------------------------------------------

async function tick(): Promise<void> {
  const structure = await fetchStructure(zurichToday())
  const riderMap = await withToken(fetchRiderMap)
  const { payloads, unmatchedRiders, droppedOrderCodes } = buildSyncPayloads(
    structure,
    null,
    riderMap
  )
  if (unmatchedRiders.length > 0) {
    log("warn", "unmatched_riders", { riders: unmatchedRiders })
  }
  if (droppedOrderCodes.length > 0) {
    log("warn", "dropped_stops", { orderCodes: droppedOrderCodes })
  }

  for (const p of payloads) {
    await withToken((t) => putVehicleRoutes(t, p.vehicleId, p.orders))
  }
  const stops = payloads.reduce(
    (n, p) => n + p.orders.reduce((m, o) => m + o.stops.length, 0),
    0
  )
  log("info", "tick", { vehicles: payloads.length, stops })
  await writeHeartbeat({ last_success_at: new Date().toISOString() })
}

async function main(): Promise<void> {
  log("info", "startup", {
    mode: FIXTURE ? "fixture" : "live",
    source: FIXTURE ?? BB_API_URL,
    interval_ms: SYNC_MS,
  })
  for (;;) {
    try {
      await tick()
    } catch (err) {
      // Keep the last good picture on the TV; never crash the loop.
      const message = err instanceof Error ? err.message : String(err)
      log("error", "tick_failed", { error: message })
      await writeHeartbeat({
        last_error: message,
        last_error_at: new Date().toISOString(),
      })
    }
    await new Promise((r) => setTimeout(r, SYNC_MS))
  }
}

void main()
