import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

// Mints a dispatcher session from server-only credentials, gated by a shared
// ingest secret. Mirrors /api/dashboard-session: the password never reaches a
// client — only the minted dispatcher session tokens do. Used by the dev seed
// script and (later) an unattended server-to-server feed adapter.
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.DISPATCHER_INGEST_SECRET
  const email = process.env.DISPATCHER_EMAIL
  const password = process.env.DISPATCHER_PASSWORD
  if (!expectedSecret || !email || !password) {
    return NextResponse.json(
      { error: "dispatcher not configured" },
      { status: 500 }
    )
  }

  if (request.headers.get("x-ingest-secret") !== expectedSecret) {
    return NextResponse.json({ error: "invalid ingest secret" }, { status: 403 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) {
    return NextResponse.json(
      { error: "dispatcher sign-in failed" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  })
}
