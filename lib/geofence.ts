import type { SupabaseClient } from "@supabase/supabase-js"

// Two-radius hysteresis: arrive on entering the inner radius, complete on leaving
// the outer one after arriving. Outer > inner so boundary jitter can't flap.
const ARRIVE_RADIUS_M = Number(process.env.GEOFENCE_ARRIVE_RADIUS_M ?? "60")
const DEPART_RADIUS_M = Number(process.env.GEOFENCE_DEPART_RADIUS_M ?? "120")

export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const la1 = toRad(aLat)
  const la2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// The single forward transition (if any) for the next stop given its distance.
export function decideTransition(
  status: string,
  distanceM: number
): "arrived" | "completed" | null {
  if (status === "planned" && distanceM <= ARRIVE_RADIUS_M) return "arrived"
  if (status === "arrived" && distanceM > DEPART_RADIUS_M) return "completed"
  return null
}

/**
 * Read the driver's next stop (lowest-seq, planned|arrived) and apply at most one
 * forward transition based on the live position. Runs as the driver: the driver
 * SELECT/UPDATE RLS policies are the boundary. Caller must guard this so a
 * geofence failure never fails the position write.
 */
export async function applyGeofence(
  supabase: SupabaseClient,
  vehicleId: string,
  lat: number,
  lng: number
): Promise<void> {
  const { data, error } = await supabase
    .from("stops")
    .select("id, lat, lng, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
    .limit(1)
  if (error) throw error
  const stop = (data ?? [])[0] as
    | { id: string; lat: number; lng: number; status: string }
    | undefined
  if (!stop) return

  const distance = haversineMeters(lat, lng, stop.lat, stop.lng)
  const next = decideTransition(stop.status, distance)
  if (!next) return

  const patch =
    next === "completed"
      ? { status: next, completed_at: new Date().toISOString() }
      : { status: next }
  const { error: updateError } = await supabase
    .from("stops")
    .update(patch)
    .eq("id", stop.id)
  if (updateError) throw updateError
}
