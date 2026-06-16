import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

// Mints a read-only dashboard session from server-only credentials, gated by a
// shared display code. The dashboard password never reaches the browser — only
// the minted session tokens (for the claim-scoped, read-only dashboard user) do.
export async function POST(request: NextRequest) {
  const expectedCode = process.env.DASHBOARD_DISPLAY_CODE
  const email = process.env.DASHBOARD_EMAIL
  const password = process.env.DASHBOARD_PASSWORD
  if (!expectedCode || !email || !password) {
    return NextResponse.json(
      { error: "dashboard not configured" },
      { status: 500 }
    )
  }

  if (request.headers.get("x-display-code") !== expectedCode) {
    return NextResponse.json({ error: "invalid display code" }, { status: 403 })
  }

  // Publishable key (not the secret key — this ships in a route bundle).
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
      { error: "dashboard sign-in failed" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  })
}
