import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

type MintArgs = {
  /** The configured secret that gates this route (undefined = not configured). */
  expectedSecret: string | undefined
  /** The secret the caller presented (from the gating header). */
  presentedSecret: string | null
  email: string | undefined
  password: string | undefined
  /** Identity label used in error messages, e.g. "dashboard" / "dispatcher". */
  label: string
}

/**
 * Mints a read-only session from server-only credentials, gated by a shared
 * secret. The password never reaches the client — only the minted session
 * tokens do. Shared by the dashboard (display code) and dispatcher (ingest
 * secret) mint routes. Status codes: 500 not configured, 403 wrong secret,
 * 500 sign-in failed, 200 tokens.
 */
export async function mintSession({
  expectedSecret,
  presentedSecret,
  email,
  password,
  label,
}: MintArgs): Promise<NextResponse> {
  if (!expectedSecret || !email || !password) {
    return NextResponse.json({ error: `${label} not configured` }, { status: 500 })
  }
  if (presentedSecret !== expectedSecret) {
    return NextResponse.json(
      { error: `invalid ${label} credential` },
      { status: 403 }
    )
  }

  // Publishable key (not the secret key — this ships in a route bundle).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    return NextResponse.json({ error: `${label} sign-in failed` }, { status: 500 })
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}
