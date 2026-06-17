/**
 * Dev-only ingestion adapter #1: seed a hand-written day of stops.
 *
 * Run with:  pnpm seed-stops   (the Next dev server must be running)
 * Flow:
 *   1. Secret key (dev-only): resolve a vehicle to assign the stops to.
 *   2. Mint a dispatcher session via POST /api/dispatcher-session (shared secret).
 *   3. POST orders+stops to /api/ingest/stops, exercising the real authed seam.
 *
 * The secret key is used ONLY to resolve a vehicle id and never leaves scripts/.
 */
import { createClient } from "@supabase/supabase-js"

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

async function resolveVehicleId(): Promise<string> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin
    .from("vehicles")
    .select("id, label")
    .order("created_at", { ascending: true })
    .limit(1)
  if (error) throw error
  const id = data?.[0]?.id
  if (!id) {
    throw new Error(
      "no vehicles found — run `pnpm fake-gps` once to seed a vehicle first."
    )
  }
  return id
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

async function main(): Promise<void> {
  const vehicleId = await resolveVehicleId()
  const token = await mintDispatcherToken()

  // A small Zürich-area day: two laundry orders, each a pickup + a return.
  const payload = {
    orders: [
      {
        external_ref: "SEED-001",
        source: "manual",
        customer_name: "Müller",
        stops: [
          { stop_type: "pickup", vehicle_id: vehicleId, seq: 1, lat: 47.3769, lng: 8.5417, address: "Bahnhofstrasse 1" },
          { stop_type: "dropoff", vehicle_id: vehicleId, seq: 2, lat: 47.3886, lng: 8.5446, address: "Bahnhofstrasse 1" },
        ],
      },
      {
        external_ref: "SEED-002",
        source: "manual",
        customer_name: "Weber",
        stops: [
          { stop_type: "pickup", vehicle_id: vehicleId, seq: 3, lat: 47.3654, lng: 8.5251, address: "Langstrasse 20" },
          { stop_type: "dropoff", vehicle_id: vehicleId, seq: 4, lat: 47.3601, lng: 8.5302, address: "Langstrasse 20" },
        ],
      },
    ],
  }

  const res = await fetch(`${API}/api/ingest/stops`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`ingest failed (${res.status}): ${await res.text()}`)
  }
  console.log(`seeded 2 orders / 4 stops for vehicle ${vehicleId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
