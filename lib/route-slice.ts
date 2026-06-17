import nearestPointOnLine from "@turf/nearest-point-on-line"
import lineSlice from "@turf/line-slice"
import type { RouteGeometry } from "@/lib/use-route"

// A truck can't move more than this far along its line between updates. A larger
// forward jump means GPS jitter or an out-and-back self-intersection snapping to
// the wrong limb — ignore it and hold the boundary. Heuristic, tunable; OSRM
// /match behind the proxy is the documented upgrade path.
const MAX_FORWARD_KM = 2

export type RouteSplit = {
  traveled: RouteGeometry | null
  remaining: RouteGeometry
  location: number // km along the line; monotonic forward per vehicle
}

/**
 * Project `position` onto `geometry` and cut it into the portion already driven
 * (traveled) and the portion left (remaining). The boundary only moves forward:
 * pass the previous split for the SAME geometry and a backward/teleporting snap
 * is rejected (boundary held). Pass `prev = null` when the geometry changed.
 */
export function splitRoute(
  geometry: RouteGeometry,
  position: [number, number],
  prev: RouteSplit | null
): RouteSplit {
  const snapped = nearestPointOnLine(geometry, position, { units: "kilometers" })
  const rawLoc = snapped.properties.location ?? 0

  if (prev) {
    const forward =
      rawLoc >= prev.location && rawLoc <= prev.location + MAX_FORWARD_KM
    if (!forward) return prev
  }

  const coords = geometry.coordinates
  if (rawLoc <= 0 || coords.length < 2) {
    return { traveled: null, remaining: geometry, location: 0 }
  }

  const snapPt = snapped.geometry.coordinates as [number, number]
  const traveled = lineSlice(coords[0], snapPt, geometry).geometry as RouteGeometry
  const remaining = lineSlice(snapPt, coords[coords.length - 1], geometry)
    .geometry as RouteGeometry
  return { traveled, remaining, location: rawLoc }
}
