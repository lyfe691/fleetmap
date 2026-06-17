"use client"

import { useEffect, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"

// OSRM with geometries=geojson returns a LineString for the route shape.
export type RouteGeometry = {
  type: "LineString"
  coordinates: [number, number][]
}

export type RouteLeg = {
  toStopId: string
  duration: number // seconds
  distance: number // metres
}

export type StopOffset = {
  stopId: string
  seq: number
  lineFraction: number // 0..1 along the full geometry; M8's grey boundary
}

export type RouteStop = {
  id: string
  seq: number
  stop_type: "pickup" | "dropoff"
  lat: number
  lng: number
  status: string
}

export type Route = {
  geometry: RouteGeometry
  totalDuration: number // seconds (ETA to the last stop)
  totalDistance: number // metres
  legs: RouteLeg[]
  stopOffsets: StopOffset[]
  stops: RouteStop[]
}

/**
 * Fetches a vehicle's driving route — current position through its non-terminal
 * stops, resolved server-side — via /api/route. Re-fetches only when the stop
 * set changes (`stopsKey`), NOT on GPS pings: the line is regenerated on stop
 * mutations; M8 slices it against the live position client-side. Clears (no
 * error) when the vehicle is idle (no vehicleId/stopsKey, or the request 409s).
 */
export function useRoute(vehicleId: string | null, stopsKey: string | null) {
  const [route, setRoute] = useState<Route | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vehicleId || !stopsKey) {
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
          `/api/route?vehicleId=${encodeURIComponent(vehicleId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        if (!res.ok) {
          // 409 = no position yet / no active stops: idle, not an error.
          if (res.status === 409) {
            if (!cancelled) {
              setRoute(null)
              setError(null)
            }
            return
          }
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
  }, [vehicleId, stopsKey])

  return { route, error, loading }
}
