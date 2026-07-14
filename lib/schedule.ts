import nearestPointOnLine from "@turf/nearest-point-on-line"
import { lineLengthKm } from "@/lib/route-slice"
import type { Route, RouteGeometry } from "@/lib/route-types"
import type { Stop } from "@/lib/use-live-stops"

// Grace window before anything reads as late — trivial slippage must not flap
// the map red or stamp a delta chip on an arrival a few minutes off schedule.
export const GRACE_MS = 5 * 60_000

/** Un-clamped fraction (0..1) of a position's snap along the route line. */
export function snapFraction(
  geometry: RouteGeometry,
  position: [number, number]
): number {
  const total = lineLengthKm(geometry)
  if (total <= 0) return 0
  const snapped = nearestPointOnLine(geometry, position, { units: "kilometers" })
  const loc = snapped.properties.location ?? 0
  return Math.min(1, Math.max(0, loc / total))
}

/**
 * Seconds of driving left from `fraction` (0..1 along the full-day line) to
 * the given stop: full legs ahead count whole, the leg the van is inside
 * counts by its un-driven share. One /api/route response serves both the
 * drawn line and this estimate — no second OSRM call. Returns null when the
 * stop isn't on the route (e.g. a refetch is in flight after a stop change).
 */
export function remainingDriveSeconds(
  route: Route,
  fraction: number,
  toStopId: string
): number | null {
  const offsets = route.stopOffsets
  if (offsets.length === 0) return null
  // The first stop has no inbound leg — the line starts there.
  if (offsets[0].stopId === toStopId) return 0
  let seconds = 0
  for (let j = 0; j < route.legs.length; j++) {
    const leg = route.legs[j]
    const from = offsets[j]
    const to = offsets[j + 1]
    // Legs and offsets are parallel arrays from /api/route (leg j arrives at
    // stop j+1); a mismatch means a malformed/stale payload — no estimate.
    if (!from || !to || to.stopId !== leg.toStopId) return null
    const span = to.lineFraction - from.lineFraction
    if (span > 0) {
      const undriven = Math.min(
        1,
        Math.max(0, (to.lineFraction - Math.max(fraction, from.lineFraction)) / span)
      )
      seconds += leg.duration * undriven
    }
    if (to.stopId === toStopId) return seconds
  }
  return null
}

export type Lateness = {
  late: boolean
  nextStopId: string | null
  /** Projected arrival (ms epoch) at the next active stop, when estimable. */
  projectedArrivalMs: number | null
  /** Estimated drive seconds to the next active stop, when estimable. */
  remainingDriveSec: number | null
}

const NOT_LATE: Lateness = {
  late: false,
  nextStopId: null,
  projectedArrivalMs: null,
  remainingDriveSec: null,
}

/**
 * A van is late when its projected arrival at the next active stop is more
 * than GRACE past that stop's scheduled eta_at. Degraded fallback when no
 * estimate is available: the scheduled time has simply passed. Never late
 * without an eta_at to compare against.
 */
export function assessLateness(input: {
  route: Route | undefined
  stops: Stop[] // the vehicle's live stops, seq-sorted
  fraction: number | null // van's snap along route.geometry (snapFraction)
  now: number
}): Lateness {
  const next =
    input.stops.find((s) => s.status === "planned" || s.status === "arrived") ??
    null
  if (!next) return NOT_LATE

  const est =
    input.route && input.fraction != null
      ? remainingDriveSeconds(input.route, input.fraction, next.id)
      : null
  const projected = est != null ? input.now + est * 1000 : null

  const etaMs = next.eta_at ? Date.parse(next.eta_at) : null
  const late =
    etaMs != null &&
    (projected != null ? projected : input.now) > etaMs + GRACE_MS

  return {
    late,
    nextStopId: next.id,
    projectedArrivalMs: projected,
    remainingDriveSec: est,
  }
}

export type ArrivalDelta =
  | { kind: "onTime" }
  | { kind: "late" | "early"; minutes: number }

/** Scheduled vs actual arrival, bucketed by the grace window. */
export function arrivalDelta(
  etaAtMs: number,
  completedAtMs: number,
  graceMs = GRACE_MS
): ArrivalDelta {
  const delta = completedAtMs - etaAtMs
  if (Math.abs(delta) <= graceMs) return { kind: "onTime" }
  return {
    kind: delta > 0 ? "late" : "early",
    minutes: Math.max(1, Math.round(Math.abs(delta) / 60_000)),
  }
}

/**
 * The schedule-side floor for the grey boundary: the farthest-along COMPLETED
 * stop's lineFraction (status from the live stops, which lead the route
 * payload). Only `completed` counts — a cancelled/failed stop ahead of the
 * van must not drag the boundary forward past road it never drove.
 */
export function completedFloorFraction(route: Route, liveStops: Stop[]): number {
  const statusById = new Map(liveStops.map((s) => [s.id, s.status]))
  let floor = 0
  for (const o of route.stopOffsets) {
    if (statusById.get(o.stopId) === "completed" && o.lineFraction > floor) {
      floor = o.lineFraction
    }
  }
  return floor
}
