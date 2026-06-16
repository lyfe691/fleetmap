import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | undefined

/**
 * Lazy singleton driver client with a persistent, auto-refreshing session — a
 * human logs in once and tracks for a multi-hour shift. Separate from
 * lib/supabase/browser.ts (persistSession:false), which is the dashboard's
 * deliberate display-token client.
 */
export function getDriverClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    )
  }
  return client
}
