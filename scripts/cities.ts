/**
 * Dev-only multi-city config — the single source of truth for the seed scripts.
 *
 * Drives both `fake-gps` (one driver + van per city, drives that city's stops)
 * and `seed-stops` (ingests each city's day of orders to its van). `upsertAreas`
 * mirrors these into the operational_areas table (data only — the console no
 * longer renders area overlays). This file only exists to seed a multi-city demo.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

export type CityStop = {
  stopType: "pickup" | "dropoff"
  lat: number
  lng: number
  address: string
}

export type CityOrder = {
  externalRef: string
  customerName: string
  stops: CityStop[]
}

export type City = {
  slug: string
  name: string
  color: string // overlay tint (hex)
  centerLng: number
  centerLat: number
  radiusM: number // soft service radius for the overlay circle
  driver: { email: string; password: string; label: string }
  orders: CityOrder[]
}

const DRIVER_PASSWORD = "fake-gps-dev-123"

export const CITIES: City[] = [
  {
    slug: "zurich",
    name: "Zürich",
    color: "#2563eb", // blue
    centerLng: 8.5417,
    centerLat: 47.3769,
    radiusM: 5000,
    driver: { email: "driver-zurich@example.com", password: DRIVER_PASSWORD, label: "Van Zürich" },
    orders: [
      {
        externalRef: "ZRH-001",
        customerName: "Müller",
        stops: [
          { stopType: "pickup", lat: 47.3769, lng: 8.5417, address: "Bahnhofstrasse 1" },
          { stopType: "dropoff", lat: 47.3886, lng: 8.5446, address: "Stampfenbachstrasse 52" },
        ],
      },
      {
        externalRef: "ZRH-002",
        customerName: "Weber",
        stops: [
          { stopType: "pickup", lat: 47.3654, lng: 8.5251, address: "Langstrasse 20" },
          { stopType: "dropoff", lat: 47.3601, lng: 8.5302, address: "Brauerstrasse 12" },
        ],
      },
    ],
  },
  {
    slug: "bern",
    name: "Bern",
    color: "#059669", // emerald
    centerLng: 7.4474,
    centerLat: 46.948,
    radiusM: 4000,
    driver: { email: "driver-bern@example.com", password: DRIVER_PASSWORD, label: "Van Bern" },
    orders: [
      {
        externalRef: "BRN-001",
        customerName: "Schmid",
        stops: [
          { stopType: "pickup", lat: 46.948, lng: 7.4474, address: "Bundesplatz 3" },
          { stopType: "dropoff", lat: 46.9512, lng: 7.4386, address: "Länggassstrasse 49" },
        ],
      },
      {
        externalRef: "BRN-002",
        customerName: "Keller",
        stops: [
          { stopType: "pickup", lat: 46.9446, lng: 7.436, address: "Effingerstrasse 21" },
          { stopType: "dropoff", lat: 46.9389, lng: 7.429, address: "Weissensteinstrasse 8" },
        ],
      },
    ],
  },
  {
    slug: "basel",
    name: "Basel",
    color: "#d97706", // amber
    centerLng: 7.5886,
    centerLat: 47.5596,
    radiusM: 4000,
    driver: { email: "driver-basel@example.com", password: DRIVER_PASSWORD, label: "Van Basel" },
    orders: [
      {
        externalRef: "BAS-001",
        customerName: "Brunner",
        stops: [
          { stopType: "pickup", lat: 47.5596, lng: 7.5886, address: "Marktplatz 9" },
          { stopType: "dropoff", lat: 47.564, lng: 7.599, address: "Clarastrasse 57" },
        ],
      },
      {
        externalRef: "BAS-002",
        customerName: "Frei",
        stops: [
          { stopType: "pickup", lat: 47.553, lng: 7.58, address: "Steinenvorstadt 33" },
          { stopType: "dropoff", lat: 47.548, lng: 7.576, address: "Gundeldingerstrasse 175" },
        ],
      },
    ],
  },
]

/**
 * Idempotently mirror CITIES into operational_areas (keyed by slug) using the
 * secret key, so areas always exist regardless of which script runs first.
 * Returns slug -> area_id.
 */
export async function upsertAreas(admin: SupabaseClient): Promise<Map<string, string>> {
  const rows = CITIES.map((c) => ({
    slug: c.slug,
    name: c.name,
    center_lat: c.centerLat,
    center_lng: c.centerLng,
    radius_m: c.radiusM,
    color: c.color,
  }))
  const { data, error } = await admin
    .from("operational_areas")
    .upsert(rows, { onConflict: "slug" })
    .select("id, slug")
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.slug as string, r.id as string]))
}
