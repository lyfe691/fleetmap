import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"
import { bearerToken, isAuthError } from "@/lib/api-auth"
import { UUID_RE } from "@/lib/ingest-validate"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

const STATUSES = ["arrived", "completed", "failed", "skipped"] as const
type Status = (typeof STATUSES)[number]

// Validate the mutation body into a stops patch. At least one mutable field.
function validate(
  body: unknown
): { patch: Record<string, unknown> } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const b = body as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !STATUSES.includes(b.status as Status)) {
      return { error: `status must be one of ${STATUSES.join(", ")}` }
    }
    patch.status = b.status
    if (b.status === "completed") patch.completed_at = new Date().toISOString()
  }

  if (b.vehicle_id !== undefined) {
    if (
      b.vehicle_id !== null &&
      (typeof b.vehicle_id !== "string" || !UUID_RE.test(b.vehicle_id))
    ) {
      return { error: "vehicle_id must be a UUID or null" }
    }
    patch.vehicle_id = b.vehicle_id
  }

  if (b.seq !== undefined) {
    if (!Number.isInteger(b.seq)) {
      return { error: "seq must be an integer" }
    }
    patch.seq = b.seq
  }

  if (Object.keys(patch).length === 0) {
    return { error: "no mutable fields (status, vehicle_id, seq)" }
  }
  return { patch }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid stop id" }, { status: 400 })
  }

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

  const parsed = validate(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { data, error } = await supabase
    .from("stops")
    .update(parsed.patch)
    .eq("id", id)
    .select("id")
    .maybeSingle()

  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    // 23505 = unique_violation on (vehicle_id, seq): a reorder into an occupied slot.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "seq already taken for this vehicle" },
        { status: 409 }
      )
    }
    console.error("[/api/stops/:id] update failed:", error)
    return NextResponse.json({ error: "db error" }, { status: 500 })
  }
  if (!data) {
    // No row updated: nonexistent id, or RLS hid it (not a dispatcher).
    return NextResponse.json({ error: "no such stop" }, { status: 404 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
