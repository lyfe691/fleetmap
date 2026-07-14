"use client"

import { useMemo, useRef } from "react"
import type { Feature, FeatureCollection } from "geojson"
import {
  lineLengthKm,
  splitRouteWithFloor,
  type RouteSplit,
} from "@/lib/route-slice"
import { completedFloorFraction } from "@/lib/schedule"
import type { Route, RouteGeometry } from "@/lib/route-types"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"

type ProgEntry = { split: RouteSplit; geometry: RouteGeometry }

export function computeRouteFeatures(
  prog: Map<string, ProgEntry>,
  routes: Map<string, Route>,
  vehicles: Vehicle[],
  stopsByVehicle: Map<string, Stop[]>,
  lateIds: Set<string>
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
    // Done boundary = max(last completed stop's offset, van's clamped snap):
    // a finished leg is fully grey even before GPS snaps past it.
    const floorKm =
      completedFloorFraction(route, stopsByVehicle.get(v.id) ?? []) *
      lineLengthKm(route.geometry)
    const bounded = splitRouteWithFloor(
      route.geometry,
      [v.last_lng, v.last_lat],
      prev,
      floorKm
    )
    prog.set(v.id, { split: bounded.split, geometry: route.geometry })
    remainingFeatures.push({
      type: "Feature",
      geometry: bounded.remaining,
      properties: { vehicle_id: v.id, late: lateIds.has(v.id) },
    })
    if (bounded.traveled) {
      traveledFeatures.push({
        type: "Feature",
        geometry: bounded.traveled,
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
  vehicles: Vehicle[],
  stopsByVehicle: Map<string, Stop[]>,
  lateIds: Set<string>
): { remaining: FeatureCollection; traveled: FeatureCollection } {
  const progressRef = useRef<Map<string, ProgEntry>>(new Map())
  return useMemo(
    () =>
      computeRouteFeatures(
        progressRef.current,
        routes,
        vehicles,
        stopsByVehicle,
        lateIds
      ),
    [routes, vehicles, stopsByVehicle, lateIds]
  )
}
