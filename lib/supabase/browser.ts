import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | undefined

/**
 * Lazy singleton browser client (publishable key, anon role). One instance backs
 * both auth (setSession) and the Realtime channel — two would desync the
 * Realtime token. Lazy so an accidental server import opens no socket.
 */
export function getBrowserClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  }
  return client
}
