/**
 * Dev-only: provision the dispatcher identity (the ingestion writer).
 *
 * Run with:  pnpm provision-dispatcher
 * Idempotently creates (or updates) a dedicated Auth user carrying
 * app_metadata.role='dispatcher' — the claim the M6 RLS policies key on so the
 * ingestion seam can write orders/stops while the TV stays read-only.
 *
 * Uses the secret key (admin). Dev/scripts only — never shipped.
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const email = process.env.DISPATCHER_EMAIL
const password = process.env.DISPATCHER_PASSWORD

if (!url || !secretKey || !email || !password) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "DISPATCHER_EMAIL, DISPATCHER_PASSWORD (copy .env.example -> .env)."
  )
}

const APP_METADATA = { role: "dispatcher" }

async function main(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: email!,
      password: password!,
      email_confirm: true,
      app_metadata: APP_METADATA,
    })
  if (
    createError &&
    !/already.*(registered|exists)/i.test(createError.message)
  ) {
    if (createError.code === "not_admin" || createError.status === 403) {
      throw new Error(
        "Supabase admin API rejected the key (403 not_admin). " +
          "SUPABASE_SECRET_KEY must be a Secret key (sb_secret_...) from " +
          "Dashboard -> Project Settings -> API Keys -> Secret keys."
      )
    }
    throw createError
  }

  if (created?.user) {
    console.log(`created dispatcher user ${email} (role=dispatcher)`)
    return
  }

  const { data: list, error: listError } = await admin.auth.admin.listUsers()
  if (listError) throw listError
  const userId = list.users.find((u) => u.email === email)?.id
  if (!userId) throw new Error("could not resolve dispatcher user id")

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: password!,
    app_metadata: APP_METADATA,
  })
  if (updateError) throw updateError
  console.log(`updated dispatcher user ${email} (role=dispatcher asserted)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
