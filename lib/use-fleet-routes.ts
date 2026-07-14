"use client"

import { useEffect, useRef, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"
import type { Route } from "@/lib/route-types"

export type RouteJob = { vehicleId: string; stopsKey: string }

type FetchOutcome =
  | { kind: "ok"; route: Route }
  | { kind: "gone" }       // 404/409 — legitimately no current route
  | { kind: "transient" }  // 5xx / network / unexpected — keep the last good line

async function fetchRoute(
  vehicleId: string,
  token: string
): Promise<FetchOutcome> {
  let res: Response
  try {
    res = await fetch(
      `/api/route?vehicleId=${encodeURIComponent(vehicleId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
  } catch {
    return { kind: "transient" } // network down
  }
  if (res.ok) return { kind: "ok", route: (await res.json()) as Route }
  if (res.status === 404 || res.status === 409) return { kind: "gone" }
  return { kind: "transient" }
}

/**
 * Fetches routes for many vehicles and caches each by its stopsKey, so a
 * vehicle's route re-fetches only when its stop set changes (not on GPS pings
 * or status flips — the full-day geometry ignores both). Returns a
 * Map<vehicleId, Route> feeding the shared route sources + the schedule math
 * in lib/schedule.ts. Drops vehicles absent from `jobs`.
 */
const TRANSIENT_RETRY_MS = 20_000

export function useFleetRoutes(jobs: RouteJob[]): Map<string, Route> {
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map())
  const [retryTick, setRetryTick] = useState(0)
  const cacheRef = useRef(new Map<string, { stopsKey: string; route: Route }>())

  // Stable primitive dep: re-run only when the set of (vehicle, stopSet) changes.
  const jobsKey = jobs
    .map((j) => `${j.vehicleId}@${j.stopsKey}`)
    .sort()
    .join(",")

  // Read the live jobs inside the effect without making it a dependency:
  // jobsKey already captures every change that should trigger a re-run.
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    const current = jobsRef.current

    const run = async () => {
      const { data } = await getBrowserClient().auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      const cache = cacheRef.current
      const present = new Set(current.map((j) => j.vehicleId))
      for (const id of [...cache.keys()]) {
        if (!present.has(id)) cache.delete(id)
      }

      let transient = false
      await Promise.all(
        current.map(async (j) => {
          const cached = cache.get(j.vehicleId)
          if (cached && cached.stopsKey === j.stopsKey) return
          const outcome = await fetchRoute(j.vehicleId, token)
          if (outcome.kind === "ok") {
            cache.set(j.vehicleId, { stopsKey: j.stopsKey, route: outcome.route })
          } else if (outcome.kind === "gone") {
            cache.delete(j.vehicleId)
          } else {
            // "transient": leave the cache entry untouched — the (slightly
            // stale) line stays visible — and retry on a timer below, so an
            // OSRM/network blip at load doesn't leave the map route-less
            // until some stop set happens to change.
            transient = true
          }
        })
      )

      if (cancelled) return
      setRoutes(new Map([...cache].map(([id, v]) => [id, v.route])))
      if (transient) {
        retryTimer = setTimeout(() => setRetryTick((n) => n + 1), TRANSIENT_RETRY_MS)
      }
    }

    void run()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [jobsKey, retryTick])

  return routes
}
