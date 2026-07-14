/**
 * Dev-only ingestion adapter #1: seed a hand-written day of stops per city.
 *
 * Run with:  pnpm seed-stops   (the Next dev server must be running, and
 *                               `pnpm fake-gps` once first to provision the vans)
 * Flow:
 *   1. Secret key (dev-only): upsert the operational_areas and resolve each
 *      city's van (by its driver's email) to assign that city's stops to.
 *   2. Mint a dispatcher session via POST /api/dispatcher-session (shared secret).
 *   3. POST every city's orders+stops to /api/ingest/routes, exercising the real
 *      authed seam. Each stop carries its vehicle_id + area_id.
 *
 * The secret key is used ONLY for setup/resolution and never leaves scripts/.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { CITIES, upsertAreas, type City } from "./cities"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const ingestSecret = process.env.DISPATCHER_INGEST_SECRET

if (!url || !secretKey || !ingestSecret) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "DISPATCHER_INGEST_SECRET (copy .env.example -> .env)."
  )
}

const API = process.env.SEED_API_URL ?? "http://localhost:3000"

// email -> user id, for resolving each city's van by its driver.
async function emailToUserId(admin: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error
  return new Map(
    data.users
      .filter((u): u is typeof u & { email: string } => Boolean(u.email))
      .map((u) => [u.email, u.id])
  )
}

async function resolveVehicleId(
  admin: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from("vehicles")
    .select("id")
    .eq("assigned_user_id", userId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

async function mintDispatcherToken(): Promise<string> {
  const res = await fetch(`${API}/api/dispatcher-session`, {
    method: "POST",
    headers: { "x-ingest-secret": ingestSecret! },
  })
  if (!res.ok) {
    throw new Error(`dispatcher-session denied (${res.status})`)
  }
  const { access_token } = (await res.json()) as { access_token: string }
  return access_token
}

// Scheduled arrivals spread across the day: first stop ~10 min out, then one
// every ~12 min, so lateness is exercisable rather than everything reading
// "due at midnight".
const ETA_FIRST_OFFSET_MS = 10 * 60_000
const ETA_SPACING_MS = 12 * 60_000

// Build one city's orders payload, threading vehicle_id + area_id and assigning
// per-van sequence numbers (stops_vehicle_seq_unique is scoped per vehicle)
// plus a per-van eta_at ladder.
function buildOrders(city: City, vehicleId: string, areaId: string, baseMs: number) {
  let seq = 0
  return city.orders.map((order) => ({
    external_ref: order.externalRef,
    source: "manual",
    customer_name: order.customerName,
    stops: order.stops.map((s) => ({
      stop_type: s.stopType,
      vehicle_id: vehicleId,
      area_id: areaId,
      seq: ++seq,
      lat: s.lat,
      lng: s.lng,
      address: s.address,
      eta_at: new Date(
        baseMs + ETA_FIRST_OFFSET_MS + (seq - 1) * ETA_SPACING_MS
      ).toISOString(),
    })),
  }))
}

// Backfill "already driven" state so the scheduled-vs-actual UI has data the
// moment the seed lands: the first ~30% of each van's stops complete with a
// mix of on-time / late / early actual arrivals (ingest_stops can't carry
// status, so this is a direct dev-only admin update — same reason "add
// return" inserts directly).
const COMPLETED_SHARE = 0.3
const ARRIVAL_JITTER_MIN = [2, 9, -1, -8, 3] // minutes vs eta_at, cycled

async function backfillCompleted(
  admin: SupabaseClient,
  vehicleId: string
): Promise<number> {
  const { data, error } = await admin
    .from("stops")
    .select("id, eta_at")
    .eq("vehicle_id", vehicleId)
    .order("seq", { ascending: true })
  if (error) throw error
  const stops = (data ?? []) as { id: string; eta_at: string | null }[]
  const doneCount = Math.floor(stops.length * COMPLETED_SHARE)
  for (let i = 0; i < doneCount; i++) {
    const s = stops[i]
    const etaMs = s.eta_at ? Date.parse(s.eta_at) : Date.now()
    const completedAt = new Date(
      etaMs + ARRIVAL_JITTER_MIN[i % ARRIVAL_JITTER_MIN.length] * 60_000
    ).toISOString()
    const { error: updError } = await admin
      .from("stops")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", s.id)
    if (updError) throw updError
  }
  return doneCount
}

async function main(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })

  const areas = await upsertAreas(admin)
  const userIds = await emailToUserId(admin)

  const baseMs = Date.now()
  const orders: ReturnType<typeof buildOrders> = []
  const vehicleIds: string[] = []
  let cityCount = 0
  for (const city of CITIES) {
    const areaId = areas.get(city.slug)
    if (!areaId) throw new Error(`no area seeded for ${city.slug}`)

    const userId = userIds.get(city.driver.email)
    const vehicleId = userId ? await resolveVehicleId(admin, userId) : null
    if (!vehicleId) {
      console.warn(
        `skipping ${city.name}: no van provisioned — run \`pnpm fake-gps\` first.`
      )
      continue
    }
    orders.push(...buildOrders(city, vehicleId, areaId, baseMs))
    vehicleIds.push(vehicleId)
    cityCount++
  }

  if (orders.length === 0) {
    throw new Error("no vans provisioned for any city — run `pnpm fake-gps` first.")
  }

  const token = await mintDispatcherToken()
  const res = await fetch(`${API}/api/ingest/routes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ routes: orders }),
  })
  if (!res.ok) {
    throw new Error(`ingest failed (${res.status}): ${await res.text()}`)
  }

  let completedCount = 0
  for (const vehicleId of vehicleIds) {
    completedCount += await backfillCompleted(admin, vehicleId)
  }

  const stopCount = orders.reduce((n, o) => n + o.stops.length, 0)
  console.log(
    `seeded ${orders.length} orders / ${stopCount} stops across ${cityCount} cities ` +
      `(${completedCount} backfilled as completed)`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
