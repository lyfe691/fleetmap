/**
 * Dev-only: provision the read-only dashboard identity (the "display token").
 *
 * Run with:  pnpm provision-dashboard
 * Idempotently creates (or updates) a dedicated Auth user carrying
 * app_metadata.role='dashboard' — the claim the M2 RLS policy keys on so the
 * office TV can read all vehicles while drivers stay scoped to their own.
 *
 * Uses the secret key (admin). Dev/scripts only — never shipped.
 */
import { adminClient, ensureUser } from "./lib/ensure-user"

const email = process.env.DASHBOARD_EMAIL
const password = process.env.DASHBOARD_PASSWORD
if (!email || !password) {
  throw new Error(
    "Missing env. Need DASHBOARD_EMAIL, DASHBOARD_PASSWORD (copy .env.example -> .env)."
  )
}

async function main(): Promise<void> {
  const { created } = await ensureUser({
    admin: adminClient(),
    email: email!,
    password: password!,
    appMetadata: { role: "dashboard" },
  })
  console.log(`${created ? "created" : "updated"} dashboard user ${email} (role=dashboard)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
