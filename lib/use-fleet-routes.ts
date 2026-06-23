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
 * vehicle's route re-fetches only when its stop set changes (not on GPS pings).
 * Returns a Map<vehicleId, Route> feeding the shared route sources + side rail
 * (legs[0].duration = ETA to the next stop). Drops vehicles absent from `jobs`.
 */
export function useFleetRoutes(jobs: RouteJob[]): Map<string, Route> {
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map())
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

      await Promise.all(
        current.map(async (j) => {
          const cached = cache.get(j.vehicleId)
          if (cached && cached.stopsKey === j.stopsKey) return
          const outcome = await fetchRoute(j.vehicleId, token)
          if (outcome.kind === "ok") {
            cache.set(j.vehicleId, { stopsKey: j.stopsKey, route: outcome.route })
          } else if (outcome.kind === "gone") {
            cache.delete(j.vehicleId)
          }
          // "transient": leave the cache entry untouched. The (slightly stale) line
          // stays visible, and because its stopsKey still differs from j.stopsKey,
          // the next jobsKey change retries the fetch naturally.
        })
      )

      if (cancelled) return
      setRoutes(new Map([...cache].map(([id, v]) => [id, v.route])))
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [jobsKey])

  return routes
}
