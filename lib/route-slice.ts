import nearestPointOnLine from "@turf/nearest-point-on-line"
import lineSlice from "@turf/line-slice"
import along from "@turf/along"
import length from "@turf/length"
import type { RouteGeometry } from "@/lib/route-types"

// A truck can't move more than this far along its line between updates. A larger
// forward jump means GPS jitter or an out-and-back self-intersection snapping to
// the wrong limb — ignore it and hold the boundary. Heuristic, tunable; OSRM
// /match behind the proxy is the documented upgrade path.
const MAX_FORWARD_KM = 2
// A single out-of-window snap is jitter; this many in a row means the vehicle
// really moved (GPS gap, off-route detour) — re-anchor instead of holding the
// boundary frozen for the rest of the leg.
const MAX_HELD = 3

export type RouteSplit = {
  traveled: RouteGeometry | null
  remaining: RouteGeometry
  location: number // km along the line; forward-clamped per vehicle
  held: number // consecutive rejected snaps since the last accepted one
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
    if (!forward && prev.held < MAX_HELD) return { ...prev, held: prev.held + 1 }
  }

  const coords = geometry.coordinates
  if (rawLoc <= 0 || coords.length < 2) {
    return { traveled: null, remaining: geometry, location: 0, held: 0 }
  }

  const snapPt = snapped.geometry.coordinates as [number, number]
  const traveled = lineSlice(coords[0], snapPt, geometry).geometry as RouteGeometry
  const remaining = lineSlice(snapPt, coords[coords.length - 1], geometry)
    .geometry as RouteGeometry
  return { traveled, remaining, location: rawLoc, held: 0 }
}

/** Length of the route line in km (same haversine turf's `location` uses). */
export function lineLengthKm(geometry: RouteGeometry): number {
  return length({ type: "Feature", properties: {}, geometry }, { units: "kilometers" })
}

/** Cut the line at an absolute distance, independent of any GPS snap. */
export function splitAtKm(
  geometry: RouteGeometry,
  km: number
): { traveled: RouteGeometry | null; remaining: RouteGeometry } {
  const coords = geometry.coordinates
  if (km <= 0 || coords.length < 2) return { traveled: null, remaining: geometry }
  const total = lineLengthKm(geometry)
  if (km >= total) {
    // Fully done: the remaining line collapses to the endpoint (renders empty).
    const end = coords[coords.length - 1]
    return {
      traveled: geometry,
      remaining: { type: "LineString", coordinates: [end, end] },
    }
  }
  const pt = along(geometry, km, { units: "kilometers" }).geometry
    .coordinates as [number, number]
  return {
    traveled: lineSlice(coords[0], pt, geometry).geometry as RouteGeometry,
    remaining: lineSlice(pt, coords[coords.length - 1], geometry)
      .geometry as RouteGeometry,
  }
}

export type BoundedSplit = {
  split: RouteSplit // snap state to carry forward (pass back as `prev`)
  traveled: RouteGeometry | null
  remaining: RouteGeometry
  boundaryKm: number // where the done/ahead boundary actually sits
}

/**
 * Full-day boundary: the grey/coloured cut is the FARTHER of the van's
 * forward-clamped snap and `floorKm` — the last completed stop's position
 * along the line. The floor keeps a finished leg fully grey even when GPS
 * hasn't snapped past it yet; the snap state itself stays floor-free so the
 * forward clamp keeps working off real GPS.
 */
export function splitRouteWithFloor(
  geometry: RouteGeometry,
  position: [number, number],
  prev: RouteSplit | null,
  floorKm: number
): BoundedSplit {
  const split = splitRoute(geometry, position, prev)
  if (floorKm <= split.location) {
    return {
      split,
      traveled: split.traveled,
      remaining: split.remaining,
      boundaryKm: split.location,
    }
  }
  const { traveled, remaining } = splitAtKm(geometry, floorKm)
  return { split, traveled, remaining, boundaryKm: floorKm }
}
