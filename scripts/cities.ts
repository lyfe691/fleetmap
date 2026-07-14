/**
 * Dev-only multi-city config — the single source of truth for the seed scripts.
 *
 * Drives both `fake-gps` (one driver + van per city, drives that city's stops)
 * and `seed-stops` (ingests each city's day of orders to its van). `upsertAreas`
 * mirrors these into the operational_areas table (data only — the console no
 * longer renders area overlays). This file only exists to seed a multi-city demo.
 *
 * Each city carries ~16–18 stops spread across a real service area so the
 * full-day route is a substantial multi-leg path (M16), and an etaSpeedFactor
 * that tunes how optimistic its scheduled eta_at values are — >1 assumes a
 * faster van than fake-gps actually drives, so that city runs visibly late
 * (red route); <1 gives comfortable slack (on time / early).
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
  etaSpeedFactor: number // schedule tightness — see file header
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
    etaSpeedFactor: 1.0, // schedule matches the driven speed → on time
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
      {
        externalRef: "ZRH-003",
        customerName: "Huber",
        stops: [
          { stopType: "pickup", lat: 47.3565, lng: 8.5532, address: "Seefeldstrasse 123" },
          { stopType: "dropoff", lat: 47.3667, lng: 8.5452, address: "Bellevueplatz 2" },
        ],
      },
      {
        externalRef: "ZRH-004",
        customerName: "Meier",
        stops: [
          { stopType: "pickup", lat: 47.3862, lng: 8.5479, address: "Universitätstrasse 84" },
          { stopType: "dropoff", lat: 47.3941, lng: 8.5296, address: "Bucheggplatz 5" },
        ],
      },
      {
        externalRef: "ZRH-005",
        customerName: "Fischer",
        stops: [
          { stopType: "pickup", lat: 47.3906, lng: 8.5177, address: "Hönggerstrasse 40" },
          { stopType: "dropoff", lat: 47.3928, lng: 8.5032, address: "Hardturmstrasse 253" },
        ],
      },
      {
        externalRef: "ZRH-006",
        customerName: "Schneider",
        stops: [
          { stopType: "pickup", lat: 47.3757, lng: 8.4992, address: "Badenerstrasse 329" },
          { stopType: "dropoff", lat: 47.3729, lng: 8.4951, address: "Albisriederstrasse 199" },
        ],
      },
      {
        externalRef: "ZRH-007",
        customerName: "Baumann",
        stops: [
          { stopType: "pickup", lat: 47.3663, lng: 8.5079, address: "Birmensdorferstrasse 150" },
          { stopType: "dropoff", lat: 47.3731, lng: 8.5441, address: "Limmatquai 92" },
        ],
      },
      {
        externalRef: "ZRH-008",
        customerName: "Steiner",
        stops: [
          { stopType: "pickup", lat: 47.3622, lng: 8.5731, address: "Klusplatz 1" },
          { stopType: "dropoff", lat: 47.3558, lng: 8.5619, address: "Zollikerstrasse 87" },
        ],
      },
      {
        externalRef: "ZRH-009",
        customerName: "Graf",
        stops: [
          { stopType: "pickup", lat: 47.3963, lng: 8.5487, address: "Winterthurerstrasse 190" },
          { stopType: "dropoff", lat: 47.4087, lng: 8.5441, address: "Schaffhauserstrasse 331" },
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
    etaSpeedFactor: 1.6, // optimistic schedule → this van runs late (red route)
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
      {
        externalRef: "BRN-003",
        customerName: "Zbinden",
        stops: [
          { stopType: "pickup", lat: 46.9479, lng: 7.4522, address: "Kramgasse 49" },
          { stopType: "dropoff", lat: 46.9591, lng: 7.4529, address: "Breitenrainplatz 4" },
        ],
      },
      {
        externalRef: "BRN-004",
        customerName: "Lehmann",
        stops: [
          { stopType: "pickup", lat: 46.9642, lng: 7.4653, address: "Wankdorffeldstrasse 102" },
          { stopType: "dropoff", lat: 46.9658, lng: 7.4592, address: "Papiermühlestrasse 71" },
        ],
      },
      {
        externalRef: "BRN-005",
        customerName: "Hofer",
        stops: [
          { stopType: "pickup", lat: 46.9412, lng: 7.4618, address: "Thunstrasse 63" },
          { stopType: "dropoff", lat: 46.9437, lng: 7.4611, address: "Muristrasse 12" },
        ],
      },
      {
        externalRef: "BRN-006",
        customerName: "Berger",
        stops: [
          { stopType: "pickup", lat: 46.9328, lng: 7.4342, address: "Seftigenstrasse 41" },
          { stopType: "dropoff", lat: 46.9284, lng: 7.4293, address: "Morillonstrasse 77" },
        ],
      },
      {
        externalRef: "BRN-007",
        customerName: "Wyss",
        stops: [
          { stopType: "pickup", lat: 46.9428, lng: 7.4211, address: "Freiburgstrasse 44" },
          { stopType: "dropoff", lat: 46.9434, lng: 7.4323, address: "Belpstrasse 37" },
        ],
      },
      {
        externalRef: "BRN-008",
        customerName: "Moser",
        stops: [
          { stopType: "pickup", lat: 46.9557, lng: 7.4301, address: "Neufeldstrasse 9" },
          { stopType: "dropoff", lat: 46.9433, lng: 7.4718, address: "Ostring 4" },
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
    etaSpeedFactor: 0.9, // slack in the schedule → on time / a little early
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
      {
        externalRef: "BAS-003",
        customerName: "Vogel",
        stops: [
          { stopType: "pickup", lat: 47.5581, lng: 7.5829, address: "Spalenberg 65" },
          { stopType: "dropoff", lat: 47.5611, lng: 7.5763, address: "Missionsstrasse 35" },
        ],
      },
      {
        externalRef: "BAS-004",
        customerName: "Suter",
        stops: [
          { stopType: "pickup", lat: 47.5678, lng: 7.5918, address: "Feldbergstrasse 42" },
          { stopType: "dropoff", lat: 47.5697, lng: 7.5812, address: "Elsässerstrasse 40" },
        ],
      },
      {
        externalRef: "BAS-005",
        customerName: "Wenger",
        stops: [
          { stopType: "pickup", lat: 47.5512, lng: 7.5934, address: "Aeschenvorstadt 55" },
          { stopType: "dropoff", lat: 47.5537, lng: 7.5992, address: "St. Alban-Vorstadt 12" },
        ],
      },
      {
        externalRef: "BAS-006",
        customerName: "Roth",
        stops: [
          { stopType: "pickup", lat: 47.5628, lng: 7.5613, address: "Burgfelderstrasse 190" },
          { stopType: "dropoff", lat: 47.5571, lng: 7.5568, address: "Wasgenring 30" },
        ],
      },
      {
        externalRef: "BAS-007",
        customerName: "Gerber",
        stops: [
          { stopType: "pickup", lat: 47.5489, lng: 7.6049, address: "Hardstrasse 43" },
          { stopType: "dropoff", lat: 47.5503, lng: 7.5966, address: "Sevogelstrasse 21" },
        ],
      },
      {
        externalRef: "BAS-008",
        customerName: "Kaufmann",
        stops: [
          { stopType: "pickup", lat: 47.5688, lng: 7.6041, address: "Riehenstrasse 90" },
          { stopType: "dropoff", lat: 47.5443, lng: 7.5852, address: "Dornacherstrasse 192" },
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
