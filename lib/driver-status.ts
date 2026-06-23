import type { GeoError } from "@/lib/use-geolocation"

/**
 * Pure mapping from geolocation/sync state to a human-readable blocked message.
 * Extracted so it can be tested without rendering the full driver app.
 */
export function syncBlockedMessage({
  geoSupported,
  geoError,
  syncError,
}: {
  geoSupported: boolean
  geoError: GeoError
  syncError: "no-vehicle" | "auth" | "storage" | null
}): string | null {
  if (!geoSupported) return "This device has no geolocation."
  if (geoError === "denied")
    return "Location permission denied — enable location for this site."
  if (syncError === "no-vehicle") return "No vehicle is assigned to this account."
  if (syncError === "auth") return "Session expired — sign out and back in."
  if (syncError === "storage")
    return "Storage error — fixes can't be saved on this device. Try another browser or disable private mode."
  return null
}
