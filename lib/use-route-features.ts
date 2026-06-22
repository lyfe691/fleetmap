"use client"

import { useMemo, useRef } from "react"
import type { Feature, FeatureCollection } from "geojson"
import { splitRoute, type RouteSplit } from "@/lib/route-slice"
import type { Route, RouteGeometry } from "@/lib/route-types"
import type { Vehicle } from "@/lib/use-live-vehicles"

type ProgEntry = { split: RouteSplit; geometry: RouteGeometry }

export function computeRouteFeatures(
  prog: Map<string, ProgEntry>,
  routes: Map<string, Route>,
  vehicles: Vehicle[]
): { remaining: FeatureCollection; traveled: FeatureCollection } {
  const remainingFeatures: Feature[] = []
  const traveledFeatures: Feature[] = []
  const seen = new Set<string>()
  for (const v of vehicles) {
    const route = routes.get(v.id)
    if (!route || v.last_lat == null || v.last_lng == null) continue
    seen.add(v.id)
    const prevEntry = prog.get(v.id)
    const prev =
      prevEntry && prevEntry.geometry === route.geometry ? prevEntry.split : null
    const split = splitRoute(route.geometry, [v.last_lng, v.last_lat], prev)
    prog.set(v.id, { split, geometry: route.geometry })
    remainingFeatures.push({
      type: "Feature",
      geometry: split.remaining,
      properties: { vehicle_id: v.id },
    })
    if (split.traveled) {
      traveledFeatures.push({
        type: "Feature",
        geometry: split.traveled,
        properties: { vehicle_id: v.id },
      })
    }
  }
  for (const id of [...prog.keys()]) if (!seen.has(id)) prog.delete(id)
  return {
    remaining: { type: "FeatureCollection", features: remainingFeatures },
    traveled: { type: "FeatureCollection", features: traveledFeatures },
  }
}

export function useRouteFeatures(
  routes: Map<string, Route>,
  vehicles: Vehicle[]
): { remaining: FeatureCollection; traveled: FeatureCollection } {
  const progressRef = useRef<Map<string, ProgEntry>>(new Map())
  return useMemo(
    () => computeRouteFeatures(progressRef.current, routes, vehicles),
    [routes, vehicles]
  )
}
