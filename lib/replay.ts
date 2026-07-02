import { haversineMeters } from "@/lib/geofence"

export type ReplayPoint = { lat: number; lng: number; tMs: number }

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDeg(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const p1 = toRad(aLat)
  const p2 = toRad(bLat)
  const dl = toRad(bLng - aLng)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/**
 * Where the vehicle was at replay time `tMs`: linear interpolation between the
 * surrounding fixes, clamped to the track's ends. `bearing` is the current
 * segment's direction, or null while standing still (zero-length segment) —
 * the marker holds its last rotation instead of snapping north.
 */
export function positionAt(
  points: ReplayPoint[],
  tMs: number
): { lat: number; lng: number; bearing: number | null } | null {
  if (points.length === 0) return null

  const segBearing = (a: ReplayPoint, b: ReplayPoint): number | null =>
    Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9
      ? null
      : bearingDeg(a.lat, a.lng, b.lat, b.lng)

  const first = points[0]
  const last = points[points.length - 1]
  if (points.length === 1 || tMs <= first.tMs) {
    return {
      lat: first.lat,
      lng: first.lng,
      bearing: points.length > 1 ? segBearing(first, points[1]) : null,
    }
  }
  if (tMs >= last.tMs) {
    return {
      lat: last.lat,
      lng: last.lng,
      bearing: segBearing(points[points.length - 2], last),
    }
  }

  // Binary search: greatest i with points[i].tMs <= tMs.
  let lo = 0
  let hi = points.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].tMs <= tMs) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  const span = b.tMs - a.tMs
  const f = span > 0 ? (tMs - a.tMs) / span : 0
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    bearing: segBearing(a, b),
  }
}

/** Uniform stride downsample to at most `max` points; the last fix is kept. */
export function thinPoints(points: ReplayPoint[], max: number): ReplayPoint[] {
  if (points.length <= max) return points
  const stride = Math.ceil(points.length / max)
  const out: ReplayPoint[] = []
  for (let i = 0; i < points.length; i += stride) out.push(points[i])
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1])
  }
  return out
}

export function traceStats(points: ReplayPoint[]): {
  distanceM: number
  durationMs: number
} {
  let distanceM = 0
  for (let i = 1; i < points.length; i++) {
    distanceM += haversineMeters(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    )
  }
  const durationMs =
    points.length > 1 ? points[points.length - 1].tMs - points[0].tMs : 0
  return { distanceM, durationMs }
}
