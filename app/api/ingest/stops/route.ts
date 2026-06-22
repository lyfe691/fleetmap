import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { validate } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500.
function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
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
