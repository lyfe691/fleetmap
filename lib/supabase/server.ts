import { createClient } from "@supabase/supabase-js"

/**
 * Request-scoped client bound to a driver's JWT, created fresh per request.
 * The publishable key is the apikey; identity rides in the Bearer token, so
 * queries run as the user and RLS is the security boundary.
 */
export function createUserClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
}
