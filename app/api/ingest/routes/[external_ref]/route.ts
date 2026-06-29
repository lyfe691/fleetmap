import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"
import { validateDeleteParams } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// Delete a route (the orders row by source+external_ref). Stops cascade off the
// map (stops.order_id is ON DELETE CASCADE); Realtime DELETE events evict the
// markers on the TV.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ external_ref: string }> }
) {
  const { external_ref } = await params
  const source = request.nextUrl.searchParams.get("source")

  const parsed = validateDeleteParams({ external_ref, source })
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const token = bearerToken(request)
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { data, error } = await supabase
    .from("orders")
    .delete()
    .eq("source", parsed.source)
    .eq("external_ref", parsed.external_ref)
    .select("id")
    .maybeSingle()

  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/routes/:external_ref] delete failed:", error)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!data) {
    // No row deleted: unknown (source, external_ref), or RLS hid it.
    return NextResponse.json({ error: "no such route" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
