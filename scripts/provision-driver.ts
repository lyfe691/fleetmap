/**
 * Dev-only: provision a standalone driver identity + its vehicle.
 *
 * Run with:  pnpm provision-driver
 * Idempotently creates (or updates) one Auth user and ensures exactly one
 * `vehicles` row is assigned to it (one vehicle per driver, unique
 * assigned_user_id). Unlike the `driver-<city>` accounts in scripts/cities.ts,
 * this driver is NOT touched by `fake-gps`, so it's safe to hand to an external
 * client (e.g. the native driver app) for live testing without the simulator
 * fighting over the same vehicle.
 *
 * Credentials come from env (TEST_DRIVER_EMAIL / TEST_DRIVER_PASSWORD /
 * TEST_DRIVER_LABEL). Uses the secret key (admin). Dev/scripts only — never shipped.
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const email = process.env.TEST_DRIVER_EMAIL
const password = process.env.TEST_DRIVER_PASSWORD
const label = process.env.TEST_DRIVER_LABEL ?? "Test Van"

if (!url || !secretKey || !email || !password) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "TEST_DRIVER_EMAIL, TEST_DRIVER_PASSWORD (copy .env.example -> .env)."
  )
}

async function main(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })

  // 1. Auth user (idempotent).
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: email!,
      password: password!,
      email_confirm: true,
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

  let userId = created?.user?.id ?? null
  if (!userId) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers()
    if (listError) throw listError
    userId = list.users.find((u) => u.email === email)?.id ?? null
    // Re-assert the password so a re-run with a changed password updates it.
    if (userId) {
      const { error: updateError } = await admin.auth.admin.updateUserById(
        userId,
        { password: password! }
      )
      if (updateError) throw updateError
    }
  }
  if (!userId) throw new Error(`could not resolve driver user id for ${email}`)

  // 2. Exactly one vehicle assigned to that user (no area — not a city van).
  const { data: existing, error: selError } = await admin
    .from("vehicles")
    .select("id")
    .eq("assigned_user_id", userId)
    .maybeSingle()
  if (selError) throw selError

  if (existing) {
    console.log(`driver ${email} already has a vehicle — nothing to do`)
    return
  }

  const { error: insError } = await admin.from("vehicles").insert({
    label,
    assigned_user_id: userId,
    status: "active",
  })
  if (insError) throw insError
  console.log(`provisioned driver ${email} + vehicle "${label}"`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
