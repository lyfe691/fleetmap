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
 * Until the dedicated Bubble Box API exists, BB_FIXTURE_FILE feeds the
 * structure fetch from a local JSON (BBRoute[]); statuses are null in
 * fixture mode.
 */
import { readFileSync } from "node:fs"
import {
  buildSyncPayloads,
  type BBRoute,
  type BBStatusEntry,
} from "../lib/bubblebox/translate"

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
const FIXTURE = process.env.BB_FIXTURE_FILE
const SYNC_MS = Number(process.env.BB_SYNC_INTERVAL_MS ?? 60_000)
const STRUCTURE_MS = Number(process.env.BB_STRUCTURE_INTERVAL_MS ?? 900_000)

if (!BB_API_URL && !FIXTURE) {
  throw new Error("Set BB_API_URL (real feed) or BB_FIXTURE_FILE (dev).")
}

// Their day boundary is local Swiss time, not UTC.
function zurichToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(
    new Date()
  )
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

// --- Bubble Box side ---------------------------------------------------------
// Final wiring (URLs, token endpoint, field names) lands when their dedicated
// API ships — see the spec's open item. Fixture mode covers everything else.

async function fetchStructure(date: string): Promise<BBRoute[]> {
  if (FIXTURE) {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as BBRoute[]
  }
  throw new Error(`BB routes endpoint not wired yet (date=${date})`)
}

async function fetchStatuses(date: string): Promise<BBStatusEntry[] | null> {
  if (FIXTURE) return null
  throw new Error(`BB status endpoint not wired yet (date=${date})`)
}

// --- Loop --------------------------------------------------------------------

let structure: BBRoute[] = []
let structureAt = 0

async function tick(): Promise<void> {
  const today = zurichToday()
  // Fixture mode re-reads every tick — the file is both structure and status
  // source, and edits should show up on the next tick, not in 15 minutes.
  if (FIXTURE || Date.now() - structureAt >= STRUCTURE_MS || structure.length === 0) {
    structure = await fetchStructure(today)
    structureAt = Date.now()
  }
  const statuses = await fetchStatuses(today)

  const riderMap = await withToken(fetchRiderMap)
  const { payloads, unmatchedRiders } = buildSyncPayloads(
    structure,
    statuses,
    riderMap
  )
  if (unmatchedRiders.length > 0) {
    console.warn(`no vehicle for rider(s): ${unmatchedRiders.join(", ")}`)
  }

  for (const p of payloads) {
    await withToken((t) => putVehicleRoutes(t, p.vehicleId, p.orders))
  }
  const stops = payloads.reduce(
    (n, p) => n + p.orders.reduce((m, o) => m + o.stops.length, 0),
    0
  )
  console.log(
    `${new Date().toISOString()} synced ${payloads.length} vehicles / ${stops} stops`
  )
}

async function main(): Promise<void> {
  console.log(`bubblebox-sync: ${FIXTURE ? `fixture ${FIXTURE}` : BB_API_URL}`)
  for (;;) {
    try {
      await tick()
    } catch (err) {
      // Keep the last good picture on the TV; never crash the loop.
      console.error("tick failed:", err instanceof Error ? err.message : err)
    }
    await new Promise((r) => setTimeout(r, SYNC_MS))
  }
}

void main()
