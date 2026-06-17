"use client"

import { useEffect, useRef, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"
import type { Route } from "@/lib/use-route"

export type RouteJob = { vehicleId: string; stopsKey: string }

async function fetchRoute(
  vehicleId: string,
  token: string
): Promise<Route | null> {
  const res = await fetch(
    `/api/route?vehicleId=${encodeURIComponent(vehicleId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  // 409 = idle (no position/stops); any non-ok = no line for this vehicle.
  if (!res.ok) return null
  return (await res.json()) as Route
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

  useEffect(() => {
    let cancelled = false

    const parsed: RouteJob[] = jobsKey
      ? jobsKey.split(",").map((entry) => {
          const at = entry.indexOf("@")
          return {
            vehicleId: entry.slice(0, at),
            stopsKey: entry.slice(at + 1),
          }
        })
      : []

    const run = async () => {
      const { data } = await getBrowserClient().auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      const cache = cacheRef.current
      const present = new Set(parsed.map((j) => j.vehicleId))
      for (const id of [...cache.keys()]) {
        if (!present.has(id)) cache.delete(id)
      }

      await Promise.all(
        parsed.map(async (j) => {
          const cached = cache.get(j.vehicleId)
          if (cached && cached.stopsKey === j.stopsKey) return
          const route = await fetchRoute(j.vehicleId, token)
          if (route) cache.set(j.vehicleId, { stopsKey: j.stopsKey, route })
          else cache.delete(j.vehicleId)
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
