import { NextResponse } from "next/server"
import { summarizeHealth } from "@/lib/health"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000"
const DRIVER_SESSION_URL = process.env.DRIVER_SESSION_URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

const PROBE_TIMEOUT_MS = 3_000
// The worker ticks every 60s; well past that means it is down or wedged.
const SYNC_STALE_MS = 5 * 60_000

async function probe(url: string, headers?: Record<string, string>) {
  try {
    const res = await fetch(url, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

type SyncState = {
  last_success_at: string | null
  last_error: string | null
  last_error_at: string | null
}

// Doubles as the PostgREST/database-path probe: ok=false means the read
// failed (service down), state=null with ok=true means the worker has just
// never written. The bare /rest/v1/ root 401s under publishable keys, so a
// real (anon-readable) table read is the reachability check.
async function readSyncState(): Promise<{
  ok: boolean
  state: SyncState | null
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, state: null }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_state?id=eq.bubblebox-sync` +
        `&select=last_success_at,last_error,last_error_at`,
      {
        headers: { apikey: SUPABASE_KEY },
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    )
    if (!res.ok) return { ok: false, state: null }
    const rows = (await res.json()) as SyncState[]
    return { ok: true, state: rows[0] ?? null }
  } catch {
    return { ok: false, state: null }
  }
}

export async function GET() {
  // Auth (GoTrue) and PostgREST are separate services — probing auth alone
  // would report green through a database-path outage, which is what every
  // real feature (ingest, dashboard reads, sync) actually depends on.
  const [authOk, rest, osrmOk, driverSessionOk] = await Promise.all([
    SUPABASE_URL && SUPABASE_KEY
      ? probe(`${SUPABASE_URL}/auth/v1/health`, { apikey: SUPABASE_KEY })
      : Promise.resolve(false),
    readSyncState(),
    probe(`${OSRM_URL}/nearest/v1/driving/8.54,47.38`),
    DRIVER_SESSION_URL ? probe(DRIVER_SESSION_URL) : Promise.resolve(null),
  ])
  const supabaseOk = authOk && rest.ok
  const sync = rest.state
  const health = summarizeHealth({
    supabaseOk,
    osrmOk,
    driverSessionOk,
  })

  // Sync is informational, not gating: a missing row means the worker has
  // never run (expected until the Bubble Box endpoints are wired).
  return NextResponse.json(
    {
      ...health,
      sync: sync?.last_success_at
        ? {
            last_success_at: sync.last_success_at,
            fresh:
              Date.now() - Date.parse(sync.last_success_at) < SYNC_STALE_MS,
            last_error: sync.last_error,
            last_error_at: sync.last_error_at,
          }
        : null,
    },
    { status: health.ok ? 200 : 503 }
  )
}
