"use client"

import { useEffect, useState } from "react"
import type { Feature, FeatureCollection, Polygon } from "geojson"
import { getBrowserClient } from "@/lib/supabase/browser"

export type OperationalArea = {
  id: string
  slug: string
  name: string
  center_lat: number
  center_lng: number
  radius_m: number
  color: string
  boundary: Polygon | null
}

const COLUMNS =
  "id, slug, name, center_lat, center_lng, radius_m, color, boundary"

/**
 * Operational areas are static reference data: fetch them once when the
 * dashboard session is ready (same `ready` gate as useLiveStops). No Realtime
 * channel — service regions don't move, so a snapshot is enough.
 */
export function useOperationalAreas(ready: boolean) {
  const [areas, setAreas] = useState<OperationalArea[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const supabase = getBrowserClient()

    void (async () => {
      const { data, error: selErr } = await supabase
        .from("operational_areas")
        .select(COLUMNS)
      if (cancelled) return
      if (selErr) {
        setError(selErr.message)
        return
      }
      setAreas((data ?? []) as OperationalArea[])
    })()

    return () => {
      cancelled = true
    }
  }, [ready])

  return { areas, error }
}

// A geodesic circle polygon around a centre — good enough for a soft overlay at
// city scale (no extra turf dependency). Used when an area has no explicit
// boundary polygon.
export function circlePolygon(
  lng: number,
  lat: number,
  radiusM: number,
  steps = 64
): Polygon {
  const R = 6_371_000
  const latR = (lat * Math.PI) / 180
  const lngR = (lng * Math.PI) / 180
  const d = radiusM / R
  const ring: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * 2 * Math.PI
    const lat2 = Math.asin(
      Math.sin(latR) * Math.cos(d) +
        Math.cos(latR) * Math.sin(d) * Math.cos(brng)
    )
    const lng2 =
      lngR +
      Math.atan2(
        Math.sin(brng) * Math.sin(d) * Math.cos(latR),
        Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
      )
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }
  return { type: "Polygon", coordinates: [ring] }
}

// FeatureCollection for the map fill/line layers. Prefers an explicit boundary
// polygon, falling back to the soft service circle. Colour rides on properties
// so a single layer can tint every city from its own hue.
export function areasToFeatureCollection(
  areas: OperationalArea[]
): FeatureCollection {
  const features: Feature[] = areas.map((a) => ({
    type: "Feature",
    geometry: a.boundary ?? circlePolygon(a.center_lng, a.center_lat, a.radius_m),
    properties: { id: a.id, name: a.name, color: a.color },
  }))
  return { type: "FeatureCollection", features }
}
