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
import { adminClient, ensureUser } from "./lib/ensure-user"

const email = process.env.DISPATCHER_EMAIL
const password = process.env.DISPATCHER_PASSWORD
if (!email || !password) {
  throw new Error(
    "Missing env. Need DISPATCHER_EMAIL, DISPATCHER_PASSWORD (copy .env.example -> .env)."
  )
}

async function main(): Promise<void> {
  const { created } = await ensureUser({
    admin: adminClient(),
    email: email!,
    password: password!,
    appMetadata: { role: "dispatcher" },
  })
  console.log(`${created ? "created" : "updated"} dispatcher user ${email} (role=dispatcher)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
