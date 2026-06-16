import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// OSRM stays internal; the dashboard only ever talks to this proxy. Defaults to
// the local dev container; in compose this is the service name (http://osrm:5000).
const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000"

// Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500.
function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}

function parseCoord(
  raw: string | null,
  min: number,
  max: number
): number | null {
  if (raw === null) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

// OSRM's route response, narrowed to what we proxy.
type OsrmRoute = { geometry: unknown; duration: number; distance: number }
type OsrmResponse = { code: string; routes?: OsrmRoute[] }

export async function GET(request: NextRequest) {
  // 1. Auth: a Bearer token is required (the dashboard session).
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  // 2. Validate query params.
  const params = request.nextUrl.searchParams
  const vehicleId = params.get("vehicleId")
  if (!vehicleId) {
    return NextResponse.json({ error: "vehicleId is required" }, { status: 400 })
  }
  const destLat = parseCoord(params.get("destLat"), -90, 90)
  if (destLat === null) {
    return NextResponse.json(
      { error: "destLat must be a number in [-90, 90]" },
      { status: 400 }
    )
  }
  const destLng = parseCoord(params.get("destLng"), -180, 180)
  if (destLng === null) {
    return NextResponse.json(
      { error: "destLng must be a number in [-180, 180]" },
      { status: 400 }
    )
  }

  // 3. Look up the vehicle's current position. Runs as the caller — the
  // dashboard role's claim-scoped select policy lets it read any vehicle.
  const supabase = createUserClient(token)
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

  // 4. Proxy OSRM. Coords are lng,lat (OSRM's order); full geojson geometry.
  const coords = `${vehicle.last_lng},${vehicle.last_lat};${destLng},${destLat}`
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

  // duration = ETA seconds, distance = metres.
  return NextResponse.json({
    geometry: best.geometry,
    duration: best.duration,
    distance: best.distance,
  })
}
