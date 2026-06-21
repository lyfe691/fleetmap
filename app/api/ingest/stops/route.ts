import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500.
function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

// Accepts ISO 8601 dates/timestamps; rejects unparseable strings.
function isIsoDateString(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v))
}

// Validate the ingestion contract and return the orders payload for the rpc.
function validate(body: unknown): { orders: unknown[] } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const orders = (body as Record<string, unknown>).orders
  if (!Array.isArray(orders) || orders.length === 0) {
    return { error: "orders must be a non-empty array" }
  }
  for (const o of orders) {
    if (typeof o !== "object" || o === null) {
      return { error: "each order must be an object" }
    }
    const ord = o as Record<string, unknown>
    if (typeof ord.external_ref !== "string" || ord.external_ref.length === 0) {
      return { error: "order.external_ref is required" }
    }
    if (!Array.isArray(ord.stops) || ord.stops.length === 0) {
      return { error: "order.stops must be a non-empty array" }
    }
    if (
      ord.scheduled_date != null &&
      ord.scheduled_date !== "" &&
      !isIsoDateString(ord.scheduled_date)
    ) {
      return { error: "order.scheduled_date must be an ISO 8601 date" }
    }
    for (const s of ord.stops) {
      if (typeof s !== "object" || s === null) {
        return { error: "each stop must be an object" }
      }
      const st = s as Record<string, unknown>
      if (st.stop_type !== "pickup" && st.stop_type !== "dropoff") {
        return { error: "stop.stop_type must be 'pickup' or 'dropoff'" }
      }
      if (!Number.isInteger(st.seq)) {
        return { error: "stop.seq must be an integer" }
      }
      if (!isFiniteNumber(st.lat) || st.lat < -90 || st.lat > 90) {
        return { error: "stop.lat must be a number in [-90, 90]" }
      }
      if (!isFiniteNumber(st.lng) || st.lng < -180 || st.lng > 180) {
        return { error: "stop.lng must be a number in [-180, 180]" }
      }
      if (
        st.vehicle_id != null &&
        st.vehicle_id !== "" &&
        !isUuid(st.vehicle_id)
      ) {
        return { error: "stop.vehicle_id must be a UUID" }
      }
      if (st.area_id != null && st.area_id !== "" && !isUuid(st.area_id)) {
        return { error: "stop.area_id must be a UUID" }
      }
      if (
        st.eta_at != null &&
        st.eta_at !== "" &&
        !isIsoDateString(st.eta_at)
      ) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
    }
  }
  return { orders }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 })
  }

  const parsed = validate(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { error } = await supabase.rpc("ingest_stops", {
    p_orders: parsed.orders,
  })
  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/stops] rpc failed:", error)
    return NextResponse.json({ error: "ingest failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
