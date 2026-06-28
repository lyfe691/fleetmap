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
import { adminClient, ensureUser } from "./lib/ensure-user"

const email = process.env.TEST_DRIVER_EMAIL
const password = process.env.TEST_DRIVER_PASSWORD
const label = process.env.TEST_DRIVER_LABEL ?? "Test Van"
if (!email || !password) {
  throw new Error(
    "Missing env. Need TEST_DRIVER_EMAIL, TEST_DRIVER_PASSWORD (copy .env.example -> .env)."
  )
}

async function main(): Promise<void> {
  const admin = adminClient()

  // 1. Auth user (idempotent, no role claim — a plain driver).
  const { id: userId } = await ensureUser({ admin, email: email!, password: password! })

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
