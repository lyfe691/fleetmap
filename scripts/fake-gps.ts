/**
 * Dev-only fake GPS poster — drives one van per city along its seeded route.
 *
 * Run with:  pnpm fake-gps   (the Next dev server + OSRM must be running)
 * Flow:
 *   1. Secret key (dev-only): upsert the operational_areas, then idempotently
 *      create one test driver + one vehicle per city (assigned to the area) —
 *      the one thing a driver can't do under RLS.
 *   2. For each van: read its active stops and ask OSRM for the road route
 *      through them — the same geometry the dashboard draws.
 *   3. Sign in as each driver and POST positions that walk along that route to
 *      /api/location every tick, so the dashboard greys each trail behind a van.
 *
 * Vans with no active stops (run `pnpm seed-stops` first) or OSRM unreachable
 * fall back to a random wander near their city centre. The secret key is used
 * ONLY for setup + reading stops and never leaves scripts/.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { CITIES, upsertAreas, type City } from "./cities"

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
const TICK_MS = 5000 // matches the dashboard marker glide window
const SPEED_MPS = Number(process.env.FAKE_GPS_SPEED ?? "12")

type Pt = [number, number] // lng, lat (OSRM/GeoJSON order)

async function ensureDriverAndVehicle(
  admin: SupabaseClient,
  city: City,
  areaId: string
): Promise<string> {
  const { email, password, label } = city.driver
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
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
    const { data: list, error: listError } = await admin.auth.admin.listUsers({
      perPage: 1000,
    })
    if (listError) throw listError
    userId = list.users.find((u) => u.email === email)?.id ?? null
  }
  if (!userId) throw new Error(`could not resolve test driver id for ${email}`)

  const { data: existing, error: selError } = await admin
    .from("vehicles")
    .select("id")
    .eq("assigned_user_id", userId)
    .maybeSingle()
  if (selError) throw selError

  if (existing) {
    // Keep the area link current (areas may have been re-seeded).
    await admin.from("vehicles").update({ area_id: areaId }).eq("id", existing.id)
    console.log(`[${city.slug}] van already provisioned`)
    return existing.id as string
  }

  const { data: inserted, error: insError } = await admin
    .from("vehicles")
    .insert({
      label,
      assigned_user_id: userId,
      area_id: areaId,
      status: "active",
    })
    .select("id")
    .single()
  if (insError) throw insError
  console.log(`[${city.slug}] seeded van "${label}"`)
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

async function fetchRouteCoords(stops: Pt[]): Promise<Pt[] | null> {
  const coords = stops.map(([lng, lat]) => `${lng},${lat}`).join(";")
  const u = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const json = (await res.json()) as {
      code: string
      routes?: { geometry: { coordinates: Pt[] } }[]
    }
    const route = json.routes?.[0]
    if (json.code !== "Ok" || !route) return null
    return route.geometry.coordinates
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

async function getDriverToken(email: string, password: string): Promise<string> {
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error("sign-in returned no access token")
  return token
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type Poster = (
  lat: number,
  lng: number,
  heading: number,
  speed: number
) => Promise<void>

// A position poster for one driver, refreshing its own token on 401.
function makePoster(city: City): Poster {
  let token: string | null = null
  return async (lat, lng, heading, speed) => {
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
      if (!token) token = await getDriverToken(city.driver.email, city.driver.password)
      let res = await send(token)
      if (res.status === 401) {
        token = await getDriverToken(city.driver.email, city.driver.password)
        res = await send(token)
      }
      if (!res.ok) {
        console.warn(`[${city.slug}] POST ${res.status}: ${await res.text()}`)
      }
    } catch (err) {
      console.warn(`[${city.slug}] POST failed (is \`pnpm dev\` running?):`, err)
    }
  }
}

// Reactivate a van's stops so the next lap is a fresh on-route run; the geofence
// greys them off again as the van passes. Dev-only, keeps the demo continuously
// live instead of freezing once every stop is completed.
async function reactivateStops(
  admin: SupabaseClient,
  vehicleId: string
): Promise<void> {
  await admin
    .from("stops")
    .update({ status: "planned", completed_at: null })
    .eq("vehicle_id", vehicleId)
    .in("status", ["arrived", "completed"])
}

// Drive one van forever: lap its closed OSRM route (…last -> first) so it returns
// to the start smoothly, reactivating stops each lap. Wanders only when there's
// no route (no stops / OSRM down), then retries.
async function driveCity(
  admin: SupabaseClient,
  city: City,
  vehicleId: string
): Promise<void> {
  const post = makePoster(city)
  const step = SPEED_MPS * (TICK_MS / 1000)

  for (;;) {
    await reactivateStops(admin, vehicleId)
    const stops = await getActiveStops(admin, vehicleId)
    const waypoints = stops.length >= 2 ? [...stops, stops[0]] : stops
    const coords =
      waypoints.length >= 2 ? await fetchRouteCoords(waypoints) : null

    if (!coords || coords.length < 2) {
      console.log(
        `[${city.slug}] no route (stops:${stops.length}; OSRM up?) — wandering, will retry.`
      )
      await wander(city, post, 24)
      continue
    }

    const path = buildPath(coords)
    console.log(
      `[${city.slug}] driving ${(path.total / 1000).toFixed(1)} km loop through ` +
        `${stops.length} stops at ${SPEED_MPS} m/s.`
    )
    let dist = 0
    while (dist < path.total) {
      const { pos, heading } = pointAt(path, dist)
      await post(pos[1], pos[0], heading, SPEED_MPS)
      dist = Math.min(dist + step, path.total)
      await sleep(TICK_MS)
    }
  }
}

// Bounded random wander (N ticks) near a city centre; used only when no route is
// available, then returns so the drive loop can retry.
async function wander(
  city: City,
  post: Poster,
  ticks: number
): Promise<void> {
  let lat = city.centerLat
  let lng = city.centerLng
  for (let i = 0; i < ticks; i++) {
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

async function main(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })

  const areas = await upsertAreas(admin)
  const vans: { city: City; vehicleId: string }[] = []
  for (const city of CITIES) {
    const areaId = areas.get(city.slug)
    if (!areaId) throw new Error(`no area seeded for ${city.slug}`)
    const vehicleId = await ensureDriverAndVehicle(admin, city, areaId)
    vans.push({ city, vehicleId })
  }

  console.log(
    `driving ${vans.length} vans (${vans.map((v) => v.city.slug).join(", ")}); ` +
      `POSTing every ${TICK_MS}ms. (Ctrl+C to stop)`
  )
  await Promise.all(vans.map(({ city, vehicleId }) => driveCity(admin, city, vehicleId)))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
