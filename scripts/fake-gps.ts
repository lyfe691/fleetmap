/**
 * Dev-only fake GPS poster — drives the seeded route.
 *
 * Run with:  pnpm fake-gps   (the Next dev server + OSRM must be running)
 * Flow:
 *   1. Secret key (dev-only): idempotently create a test driver + a vehicle
 *      assigned to them — the one thing a driver can't do under RLS.
 *   2. Read that vehicle's active stops and ask OSRM for the road route through
 *      them — the same geometry the dashboard draws.
 *   3. Sign in as the driver and POST positions that walk along that route to
 *      /api/location every tick, so the dashboard greys the trail behind the van.
 *
 * With no active stops (run `pnpm seed-stops` first) or OSRM unreachable, it
 * falls back to the original random wander. The secret key is used ONLY for
 * setup + reading stops and never leaves scripts/.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!url || !publishableKey || !secretKey) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, " +
      "SUPABASE_SECRET_KEY (copy .env.example -> .env)."
  )
}

const API_URL =
  process.env.FAKE_GPS_API_URL ?? "http://localhost:3000/api/location"
const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000"
const TEST_EMAIL = "driver1@example.com"
const TEST_PASSWORD = "fake-gps-dev-123"
const TICK_MS = 5000 // matches the dashboard marker glide window
const SPEED_MPS = Number(process.env.FAKE_GPS_SPEED ?? "12")

type Pt = [number, number] // lng, lat (OSRM/GeoJSON order)

async function ensureDriverAndVehicle(admin: SupabaseClient): Promise<string> {
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
  if (
    createError &&
    !/already.*(registered|exists)/i.test(createError.message)
  ) {
    if (createError.code === "not_admin" || createError.status === 403) {
      throw new Error(
        "Supabase admin API rejected the key (403 not_admin). " +
          "SUPABASE_SECRET_KEY must be a Secret key (sb_secret_...) from " +
          "Dashboard -> Project Settings -> API Keys -> Secret keys — " +
          "not the publishable key."
      )
    }
    throw createError
  }

  let userId = created?.user?.id ?? null
  if (!userId) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers()
    if (listError) throw listError
    userId = list.users.find((u) => u.email === TEST_EMAIL)?.id ?? null
  }
  if (!userId) throw new Error("could not resolve test driver user id")

  const { data: existing, error: selError } = await admin
    .from("vehicles")
    .select("id")
    .eq("assigned_user_id", userId)
    .maybeSingle()
  if (selError) throw selError

  if (existing) {
    console.log(`vehicle already provisioned for ${TEST_EMAIL}`)
    return existing.id as string
  }

  const { data: inserted, error: insError } = await admin
    .from("vehicles")
    .insert({ label: "Fake Van 1", assigned_user_id: userId, status: "active" })
    .select("id")
    .single()
  if (insError) throw insError
  console.log(`seeded vehicle for ${TEST_EMAIL}`)
  return inserted.id as string
}

async function getActiveStops(
  admin: SupabaseClient,
  vehicleId: string
): Promise<Pt[]> {
  const { data, error } = await admin
    .from("stops")
    .select("lng, lat, seq, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
  if (error) throw error
  return ((data ?? []) as { lng: number; lat: number }[]).map((s) => [
    s.lng,
    s.lat,
  ])
}

async function fetchRouteGeometry(waypoints: Pt[]): Promise<Pt[] | null> {
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(";")
  const u = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const json = (await res.json()) as {
      code: string
      routes?: { geometry: { coordinates: Pt[] } }[]
    }
    if (json.code !== "Ok" || !json.routes?.[0]) return null
    return json.routes[0].geometry.coordinates
  } catch {
    return null
  }
}

function toRad(d: number): number {
  return (d * Math.PI) / 180
}

function haversineMeters(a: Pt, b: Pt): number {
  const R = 6_371_000
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const la1 = toRad(a[1])
  const la2 = toRad(b[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function bearingDeg(a: Pt, b: Pt): number {
  const la1 = toRad(a[1])
  const la2 = toRad(b[1])
  const dLng = toRad(b[0] - a[0])
  const y = Math.sin(dLng) * Math.cos(la2)
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

type Path = { coords: Pt[]; cum: number[]; total: number }

function buildPath(coords: Pt[]): Path {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]))
  }
  return { coords, cum, total: cum[cum.length - 1] }
}

// The interpolated position + heading `dist` metres along the path.
function pointAt(path: Path, dist: number): { pos: Pt; heading: number } {
  const { coords, cum, total } = path
  const d = Math.max(0, Math.min(dist, total))
  let i = 1
  while (i < cum.length && cum[i] < d) i++
  if (i >= coords.length) {
    const a = coords[coords.length - 2] ?? coords[0]
    const b = coords[coords.length - 1]
    return { pos: b, heading: bearingDeg(a, b) }
  }
  const segLen = cum[i] - cum[i - 1] || 1
  const t = (d - cum[i - 1]) / segLen
  const a = coords[i - 1]
  const b = coords[i]
  return {
    pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    heading: bearingDeg(a, b),
  }
}

async function getDriverToken(): Promise<string> {
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error("sign-in returned no access token")
  return token
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })
  const vehicleId = await ensureDriverAndVehicle(admin)
  const stops = await getActiveStops(admin, vehicleId)

  let token = await getDriverToken()

  const post = async (
    lat: number,
    lng: number,
    heading: number,
    speed: number
  ): Promise<void> => {
    const body = JSON.stringify({
      lat,
      lng,
      heading,
      speed,
      recorded_at: new Date().toISOString(),
    })
    const send = (jwt: string) =>
      fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body,
      })
    try {
      let res = await send(token)
      if (res.status === 401) {
        token = await getDriverToken()
        res = await send(token)
      }
      if (res.ok) {
        console.log(`POST ${res.status}  ${lat.toFixed(5)}, ${lng.toFixed(5)}`)
      } else {
        console.warn(`POST ${res.status}: ${await res.text()}`)
      }
    } catch (err) {
      console.warn("POST failed (is `pnpm dev` running?):", err)
    }
  }

  const geometry =
    stops.length > 0 ? await fetchRouteGeometry([stops[0], ...stops]) : null

  if (!geometry || geometry.length < 2) {
    const why =
      stops.length === 0
        ? "no active stops (run `pnpm seed-stops` first)"
        : "OSRM route unavailable (is `docker compose up -d osrm` running?)"
    console.log(`${why} — falling back to random wander.`)
    await randomWalk(post)
    return
  }

  const path = buildPath(geometry)
  const step = SPEED_MPS * (TICK_MS / 1000)
  console.log(
    `driving ${(path.total / 1000).toFixed(1)} km through ${stops.length} ` +
      `stops at ${SPEED_MPS} m/s; reload the dashboard now to watch the trail grey. ` +
      `(Ctrl+C to stop)`
  )

  let dist = 0
  for (;;) {
    const { pos, heading } = pointAt(path, dist)
    const atEnd = dist >= path.total
    await post(pos[1], pos[0], heading, atEnd ? 0 : SPEED_MPS)
    if (atEnd) {
      // Arrived at the final stop: hold here so the van stays active (not stale)
      // and the route shows fully driven. Restart the script to replay.
      await sleep(TICK_MS)
      continue
    }
    dist = Math.min(dist + step, path.total)
    await sleep(TICK_MS)
  }
}

// Original behavior: wander around Zürich. Used when there's no route to drive.
async function randomWalk(
  post: (lat: number, lng: number, heading: number, speed: number) => Promise<void>
): Promise<void> {
  let lat = 47.3769
  let lng = 8.5417
  console.log(`wandering near Zürich; POSTing every ${TICK_MS}ms (Ctrl+C to stop)`)
  for (;;) {
    const dLat = (Math.random() - 0.5) * 0.0015
    const dLng = (Math.random() - 0.5) * 0.0015
    lat += dLat
    lng += dLng
    let heading = (Math.atan2(dLng, dLat) * 180) / Math.PI
    if (heading < 0) heading += 360
    await post(lat, lng, heading, Math.round(Math.random() * 14))
    await sleep(TICK_MS)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
