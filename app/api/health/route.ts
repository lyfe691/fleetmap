import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const OSRM_URL = process.env.OSRM_URL ?? "http://localhost:5000"
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

async function readSyncState(): Promise<SyncState | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null
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
    if (!res.ok) return null
    const rows = (await res.json()) as SyncState[]
    return rows[0] ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const [supabaseOk, osrmOk, sync] = await Promise.all([
    SUPABASE_URL && SUPABASE_KEY
      ? probe(`${SUPABASE_URL}/auth/v1/health`, { apikey: SUPABASE_KEY })
      : Promise.resolve(false),
    probe(`${OSRM_URL}/nearest/v1/driving/8.54,47.38`),
    readSyncState(),
  ])

  // Sync is informational, not gating: a missing row means the worker has
  // never run (expected until the Bubble Box endpoints are wired).
  const ok = supabaseOk && osrmOk
  return NextResponse.json(
    {
      ok,
      supabase: supabaseOk ? "ok" : "down",
      osrm: osrmOk ? "ok" : "down",
      sync: sync?.last_success_at
        ? {
            last_success_at: sync.last_success_at,
            fresh: Date.now() - Date.parse(sync.last_success_at) < SYNC_STALE_MS,
            last_error: sync.last_error,
            last_error_at: sync.last_error_at,
          }
        : null,
    },
    { status: ok ? 200 : 503 }
  )
}
