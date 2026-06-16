/**
 * Dev-only fake GPS poster — the M1 end-to-end proof.
 *
 * Run with:  pnpm fake-gps   (= `tsx --env-file=.env scripts/fake-gps.ts`)
 * The Next dev server must already be running (`pnpm dev`).
 *
 * Flow:
 *   1. Secret key (dev-only): idempotently create a test driver + a vehicle
 *      assigned to them — the one thing a driver can't do under RLS.
 *   2. Anon: sign in as that driver to get a real JWT.
 *   3. POST a moving feed to /api/location every ~5s, exercising the real
 *      authed ingest path (auth -> validation -> RLS-scoped insert + update).
 *
 * The secret key is used ONLY for setup and never leaves scripts/.
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY

if (!url || !publishableKey || !secretKey) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, " +
      "SUPABASE_SECRET_KEY (copy .env.example -> .env)."
  )
}

const API_URL =
  process.env.FAKE_GPS_API_URL ?? "http://localhost:3000/api/location"
const TEST_EMAIL = "driver1@example.com"
const TEST_PASSWORD = "fake-gps-dev-123"
const TICK_MS = 5000

async function ensureDriverAndVehicle(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })

  // Create the test driver (idempotent: ignore "already exists").
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true, // usable immediately, no email step
    })
  if (
    createError &&
    !/already.*(registered|exists)/i.test(createError.message)
  ) {
    if (createError.code === "not_admin" || createError.status === 403) {
      throw new Error(
        "Supabase admin API rejected the key (403 not_admin). " +
          "SUPABASE_SECRET_KEY must be a Secret key (sb_secret_...) from " +
          "Dashboard -> Project Settings -> API Keys -> Secret keys — " +
          "not the publishable key."
      )
    }
    throw createError
  }

  // Resolve the user id (createUser returns null when the user already existed).
  let userId = created?.user?.id ?? null
  if (!userId) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers()
    if (listError) throw listError
    userId = list.users.find((u) => u.email === TEST_EMAIL)?.id ?? null
  }
  if (!userId) throw new Error("could not resolve test driver user id")

  // Ensure a vehicle assigned to the driver (secret key bypasses RLS).
  const { data: existing, error: selError } = await admin
    .from("vehicles")
    .select("id")
    .eq("assigned_user_id", userId)
    .maybeSingle()
  if (selError) throw selError

  if (!existing) {
    const { error: insError } = await admin.from("vehicles").insert({
      label: "Fake Van 1",
      assigned_user_id: userId,
      status: "active",
    })
    if (insError) throw insError
    console.log(`seeded vehicle for ${TEST_EMAIL}`)
  } else {
    console.log(`vehicle already provisioned for ${TEST_EMAIL}`)
  }
}

async function getDriverToken(): Promise<string> {
  const client = createClient(url!, publishableKey!, {
    auth: { persistSession: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error) throw error
  const token = data.session?.access_token
  if (!token) throw new Error("sign-in returned no access token")
  return token
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  await ensureDriverAndVehicle()
  const token = await getDriverToken()
  console.log(
    `signed in; POSTing to ${API_URL} every ${TICK_MS}ms (Ctrl+C to stop)`
  )

  // Wander around Zürich.
  let lat = 47.3769
  let lng = 8.5417

  for (;;) {
    const dLat = (Math.random() - 0.5) * 0.0015
    const dLng = (Math.random() - 0.5) * 0.0015
    lat += dLat
    lng += dLng
    let heading = (Math.atan2(dLng, dLat) * 180) / Math.PI
    if (heading < 0) heading += 360
    const speed = Math.round(Math.random() * 14) // rough m/s

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lat,
          lng,
          heading,
          speed,
          recorded_at: new Date().toISOString(),
        }),
      })
      if (res.ok) {
        console.log(`POST ${res.status}  ${lat.toFixed(5)}, ${lng.toFixed(5)}`)
      } else {
        console.warn(`POST ${res.status}: ${await res.text()}`)
      }
    } catch (err) {
      console.warn("POST failed (is `pnpm dev` running?):", err)
    }

    await sleep(TICK_MS)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
