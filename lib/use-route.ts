"use client"

import { useEffect, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"

// OSRM with geometries=geojson returns a LineString for the route shape.
export type RouteGeometry = {
  type: "LineString"
  coordinates: [number, number][]
}

export type Route = {
  geometry: RouteGeometry
  duration: number // seconds (ETA)
  distance: number // metres
}

/**
 * Fetches a driving route from a vehicle's current position (resolved
 * server-side) to `dest` via the /api/route OSRM proxy. Re-runs when the
 * vehicle moves — pass `positionKey` derived from its latest lat/lng so the
 * line and ETA track the truck. No-ops (and clears) when nothing is selected.
 */
export function useRoute(
  vehicleId: string | null,
  dest: { lat: number; lng: number } | null,
  positionKey: string | null
) {
  const [route, setRoute] = useState<Route | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vehicleId || !dest) {
      setRoute(null)
      setError(null)
      return
    }

    let cancelled = false

    const run = async () => {
      setLoading(true)
      try {
        const { data } = await getBrowserClient().auth.getSession()
        const token = data.session?.access_token
        if (!token) throw new Error("no dashboard session")

        const res = await fetch(
          `/api/route?vehicleId=${encodeURIComponent(vehicleId)}` +
            `&destLat=${dest.lat}&destLng=${dest.lng}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(body.error ?? `route failed (${res.status})`)
        }
        const json = (await res.json()) as Route
        if (!cancelled) {
          setRoute(json)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "route failed")
          setRoute(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [vehicleId, dest?.lat, dest?.lng, positionKey])

  return { route, error, loading }
}
