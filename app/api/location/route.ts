import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// Tolerate up to 60s of forward clock skew on device timestamps.
const FUTURE_SKEW_MS = 60_000

type LocationInput = {
  lat: number
  lng: number
  heading: number | null
  speed: number | null
  accuracy: number | null
  recorded_at: string
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

// Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500.
function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}

// Validate and narrow the request body.
function validate(body: unknown): { value: LocationInput } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>

  if (!isFiniteNumber(b.lat) || b.lat < -90 || b.lat > 90) {
    return { error: "lat must be a number in [-90, 90]" }
  }
  if (!isFiniteNumber(b.lng) || b.lng < -180 || b.lng > 180) {
    return { error: "lng must be a number in [-180, 180]" }
  }

  if (typeof b.recorded_at !== "string") {
    return { error: "recorded_at is required (ISO timestamp)" }
  }
  const recordedMs = new Date(b.recorded_at).getTime()
  if (!Number.isFinite(recordedMs)) {
    return { error: "recorded_at is not a valid timestamp" }
  }
  if (recordedMs > Date.now() + FUTURE_SKEW_MS) {
    return { error: "recorded_at is in the future" }
  }

  let heading: number | null = null
  if (b.heading !== undefined && b.heading !== null) {
    if (!isFiniteNumber(b.heading) || b.heading < 0 || b.heading >= 360) {
      return { error: "heading must be a number in [0, 360)" }
    }
    heading = b.heading
  }

  let speed: number | null = null
  if (b.speed !== undefined && b.speed !== null) {
    if (!isFiniteNumber(b.speed) || b.speed < 0) {
      return { error: "speed must be a number >= 0" }
    }
    speed = b.speed
  }

  let accuracy: number | null = null
  if (b.accuracy !== undefined && b.accuracy !== null) {
    if (!isFiniteNumber(b.accuracy) || b.accuracy < 0) {
      return { error: "accuracy must be a number >= 0" }
    }
    accuracy = b.accuracy
  }

  return {
    value: {
      lat: b.lat,
      lng: b.lng,
      heading,
      speed,
      accuracy,
      recorded_at: b.recorded_at,
    },
  }
}

export async function POST(request: NextRequest) {
  // 1. Auth: a Bearer token is required.
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  // 2. Body: malformed/empty JSON throws.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 })
  }

  // 3. Validate + narrow.
  const parsed = validate(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { lat, lng, heading, speed, accuracy, recorded_at } = parsed.value

  // 4. Run as the driver — RLS scopes the query to their own vehicle.
  const supabase = createUserClient(token)
  const { data: vehicle, error: lookupError } = await supabase
    .from("vehicles")
    .select("id")
    .maybeSingle()
  if (lookupError) {
    if (isAuthError(lookupError)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/location] vehicle lookup failed:", lookupError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!vehicle) {
    return NextResponse.json({ error: "no vehicle for user" }, { status: 409 })
  }

  // 5. Append to history.
  const { error: insertError } = await supabase
    .from("vehicle_positions")
    .insert({
      vehicle_id: vehicle.id,
      lat,
      lng,
      heading,
      speed,
      accuracy,
      recorded_at,
    })
  if (insertError) {
    console.error("[/api/location] position insert failed:", insertError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }

  // 6. Update the latest-position row. Position columns only (never id/
  // assigned_user_id — RLS WITH CHECK); last_seen_at is server time.
  const { error: updateError } = await supabase
    .from("vehicles")
    .update({
      last_lat: lat,
      last_lng: lng,
      last_heading: heading,
      last_speed: speed,
      last_seen_at: new Date().toISOString(),
      status: "active",
    })
    .eq("id", vehicle.id)
  if (updateError) {
    console.error("[/api/location] vehicle update failed:", updateError)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
