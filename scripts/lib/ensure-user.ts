import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const ADMIN_KEY_HINT =
  "Supabase admin API rejected the key (403 not_admin). " +
  "SUPABASE_SECRET_KEY must be a Secret key (sb_secret_...) from " +
  "Dashboard -> Project Settings -> API Keys -> Secret keys."

/** Admin client from env (secret key). Dev/scripts only — never shipped. */
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) {
    throw new Error(
      "Missing env. Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY " +
        "(copy .env.example -> .env)."
    )
  }
  return createClient(url, secretKey, { auth: { persistSession: false } })
}

type EnsureUserArgs = {
  admin: SupabaseClient
  email: string
  password: string
  /** app_metadata to assert (e.g. { role: 'dashboard' }); omitted for plain users. */
  appMetadata?: Record<string, unknown>
}

/**
 * Idempotently create-or-update an Auth user. Re-asserts the password (and
 * app_metadata, if given) on an existing user so a re-run with changed values
 * updates them. Returns the user id and whether it was freshly created.
 */
export async function ensureUser({
  admin,
  email,
  password,
  appMetadata,
}: EnsureUserArgs): Promise<{ id: string; created: boolean }> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    ...(appMetadata ? { app_metadata: appMetadata } : {}),
  })
  if (createError && !/already.*(registered|exists)/i.test(createError.message)) {
    if (createError.code === "not_admin" || createError.status === 403) {
      throw new Error(ADMIN_KEY_HINT)
    }
    throw createError
  }
  if (created?.user) return { id: created.user.id, created: true }

  // Already existed: resolve the id and re-assert password (+ metadata).
  const { data: list, error: listError } = await admin.auth.admin.listUsers()
  if (listError) throw listError
  const userId = list.users.find((u) => u.email === email)?.id
  if (!userId) throw new Error(`could not resolve user id for ${email}`)

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
    ...(appMetadata ? { app_metadata: appMetadata } : {}),
  })
  if (updateError) throw updateError
  return { id: userId, created: false }
}
