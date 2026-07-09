import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"
import { validateVehicleRoutes } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// The sync worker's write path: one vehicle's full Bubble Box picture per
// call, diff-applied by the RPC. Source is fixed — manual/seeded orders are
// out of the replace scope by construction.
const SOURCE = "bubblebox"

export async function PUT(request: NextRequest) {
  const token = bearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 })
  }

  const parsed = validateVehicleRoutes(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { error } = await supabase.rpc("sync_vehicle_routes", {
    p_vehicle_id: parsed.vehicle_id,
    p_source: SOURCE,
    p_orders: parsed.orders,
  })
  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/vehicle-routes] rpc failed:", error)
    return NextResponse.json({ error: "sync failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
