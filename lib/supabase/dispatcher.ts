import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let client: SupabaseClient | undefined

/**
 * Lazy singleton dispatcher client with a persistent, auto-refreshing session —
 * a dispatcher logs in once and works a shift. Separate from
 * lib/supabase/browser.ts (persistSession: false), the dashboard's deliberate
 * display-token client.
 */
export function getDispatcherClient(): SupabaseClient {
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
