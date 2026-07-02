// Placeholder data (no telematics or orders/deliveries model yet); stable per
// vehicle id. Surfaced as placeholder in the UI via PlaceholderNote.

const DRIVERS = [
  "M. Frei",
  "S. Keller",
  "L. Brunner",
  "A. Meier",
  "N. Weber",
  "C. Suter",
  "R. Baumann",
  "J. Graf",
]

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const ASSUMED_VEHICLE_MODEL = "Ford Transit Custom"

// Vehicles have no origin in the schema yet — placeholder depot label.
export const ASSUMED_ORIGIN = "Depot"

type AssumedDetails = {
  capacityPct: number
  loadCount: number
  loadWeight: string
  driver: string
  plate: string
  model: string
  odometer: string
  fuelPct: number
  cargoTemp: string
}

export function assumedVehicleDetails(id: string): AssumedDetails {
  const h = hashId(id)
  const odo = 30_000 + (h % 170_000)
  return {
    capacityPct: 18 + (h % 78),
    loadCount: 4 + (h % 28),
    loadWeight: (0.4 + (h % 90) / 50).toFixed(1) + " t",
    driver: DRIVERS[h % DRIVERS.length],
    plate: "ZH " + (10_000 + (h % 89_000)),
    model: ASSUMED_VEHICLE_MODEL,
    odometer: odo.toLocaleString("de-CH") + " km",
    fuelPct: 22 + (h % 70),
    cargoTemp: 3 + (h % 7) + " °C",
  }
}

type AssumedPhoto = { id: string; label: string; meta: string }

export function assumedCargoPhotos(id: string): AssumedPhoto[] {
  const h = hashId(id)
  const labels = ["Loaded at depot", "Mid-route check", "Seal intact"]
  return labels.map((label, i) => ({
    id: `${id}-photo-${i}`,
    label,
    meta: `${8 + ((h + i * 37) % 9)}:${String((h + i * 11) % 60).padStart(2, "0")} · today`,
  }))
}

type AssumedManifestRow = { id: string; label: string; sub: string; value: string }

export function assumedManifest(id: string): AssumedManifestRow[] {
  const d = assumedVehicleDetails(id)
  return [
    { id: "pkg", label: "Packages", sub: "Textile bags + crates", value: `${d.loadCount}` },
    { id: "gross", label: "Gross weight", sub: "Scanned at load", value: d.loadWeight },
    { id: "temp", label: "Temperature log", sub: "Within range", value: d.cargoTemp },
  ]
}

