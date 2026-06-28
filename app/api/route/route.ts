import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// OSRM stays internal; the dashboard only ever talks to this proxy. Defaults to
// the local dev container; in compose this is the service name (http://osrm:5000).
const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000"

type StopRow = {
  id: string
  seq: number
  stop_type: "pickup" | "dropoff"
  lat: number
  lng: number
  status: string
}

// OSRM's route response, narrowed to what we proxy. One leg per waypoint pair.
type OsrmLeg = { duration: number; distance: number }
type OsrmRoute = {
  geometry: unknown
  duration: number
  distance: number
  legs?: OsrmLeg[]
}
type OsrmResponse = { code: string; routes?: OsrmRoute[] }

export async function GET(request: NextRequest) {
  // 1. Auth: a Bearer token is required (the dashboard session).
  const token = bearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  const vehicleId = request.nextUrl.searchParams.get("vehicleId")
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 })
  }

  // Runs as the caller — the dashboard role's claim-scoped select policies let
  // it read any vehicle and its stops.
  const supabase = createUserClient(token)

  // 2. The vehicle's current position.
  const { data: vehicle, error: lookupError } = await supabase
    .from("vehicles")
    .select("last_lat, last_lng")
    .eq("id", vehicleId)
    .maybeSingle()
  if (lookupError) {
    if (isAuthError(lookupError)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/route] vehicle lookup failed:", lookupError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!vehicle) {
    return NextResponse.json({ error: "no such vehicle" }, { status: 409 })
  }
  if (vehicle.last_lat == null || vehicle.last_lng == null) {
    return NextResponse.json(
      { error: "vehicle has no known position yet" },
      { status: 409 }
    )
  }

  // 3. Non-terminal stops in visit order. seq is treated as the true visit
  // order (OSRM does not reorder waypoints).
  const { data: stopRows, error: stopsError } = await supabase
    .from("stops")
    .select("id, seq, stop_type, lat, lng, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
  if (stopsError) {
    if (isAuthError(stopsError)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/route] stops lookup failed:", stopsError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  const stops = (stopRows ?? []) as StopRow[]
  if (stops.length === 0) {
    return NextResponse.json(
      { error: "vehicle has no active stops" },
      { status: 409 }
    )
  }

  // 4. Proxy OSRM. Waypoints: live position, then each stop in seq order.
  // Coords are lng,lat (OSRM's order); full geojson geometry.
  const waypoints: [number, number][] = [
    [vehicle.last_lng, vehicle.last_lat],
    ...stops.map((s) => [s.lng, s.lat] as [number, number]),
  ]
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(";")
  const osrmUrl = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`

  let osrm: OsrmResponse
  try {
    const res = await fetch(osrmUrl)
    if (!res.ok) {
      console.error(`[/api/route] OSRM responded ${res.status}`)
      return NextResponse.json({ error: "routing upstream error" }, { status: 502 })
    }
    osrm = (await res.json()) as OsrmResponse
  } catch (err) {
    console.error("[/api/route] OSRM unreachable:", err)
    return NextResponse.json({ error: "routing unavailable" }, { status: 502 })
  }

  const best = osrm.routes?.[0]
  if (osrm.code !== "Ok" || !best) {
    // e.g. NoRoute / NoSegment — a valid OSRM answer, just no path.
    return NextResponse.json({ error: `no route (${osrm.code})` }, { status: 404 })
  }

  // 5. One leg per waypoint pair => leg j arrives at stops[j].
  const osrmLegs = best.legs ?? []
  const legs = stops.map((s, j) => ({
    toStopId: s.id,
    duration: osrmLegs[j]?.duration ?? 0,
    distance: osrmLegs[j]?.distance ?? 0,
  }))

  // 6. Each stop's fractional offset along the full line = cumulative leg
  // distance / total distance. M8's grey boundary clamps to these.
  const total = best.distance || 1
  let cumulative = 0
  const stopOffsets = stops.map((s, j) => {
    cumulative += osrmLegs[j]?.distance ?? 0
    return {
      stopId: s.id,
      seq: s.seq,
      lineFraction: Math.min(1, cumulative / total),
    }
  })

  return NextResponse.json({
    geometry: best.geometry,
    totalDuration: best.duration,
    totalDistance: best.distance,
    legs,
    stopOffsets,
    stops: stops.map((s) => ({
      id: s.id,
      seq: s.seq,
      stop_type: s.stop_type,
      lat: s.lat,
      lng: s.lng,
      status: s.status,
    })),
  })
}
