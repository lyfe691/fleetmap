import { isActive } from "@/components/map/fleet-format"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import { isStale } from "@/components/map/vehicle-marker"
import { assumedVehicleDetails } from "@/lib/console/assumed"

export type StatusTone = "onRoute" | "waiting"

export type ConsoleVehicle = {
  // real
  id: string
  reg: string
  tone: StatusTone
  statusLabel: string
  stale: boolean
  origin: string
  dest: string
  etaText: string
  routeTimer: string
  routeLeftText: string
  stopsLeft: number
  routeProgressPct: number
  speedText: string
  // assumed (placeholder — see lib/console/assumed.ts)
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

function formatEta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 1) return "<1 min"
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function hms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

export function buildConsoleVehicles(input: {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
}): ConsoleVehicle[] {
  const { vehicles, stopsByVehicle, routes, now } = input

  const built = vehicles.map((v) => {
    const stops = stopsByVehicle.get(v.id) ?? []
    const active = stops.filter(isActive)
    const hasActive = active.length > 0
    const next = active[0] ?? null
    const route = routes.get(v.id)

    const stale = isStale(v.last_seen_at, now)
    const etaSec = route?.legs?.[0]?.duration ?? null
    const totalStops = stops.length
    const doneStops = Math.max(0, totalStops - active.length)
    const assumed = assumedVehicleDetails(v.id)

    return {
      id: v.id,
      reg: v.label ?? v.id.slice(0, 8),
      tone: hasActive ? "onRoute" : "waiting",
      statusLabel: hasActive ? "On Route" : "Waiting",
      stale,
      origin: "Depot",
      dest: next ? (next.stop_type === "pickup" ? "Pickup" : "Dropoff") : "—",
      etaText: hasActive ? (etaSec != null ? formatEta(etaSec) : "—") : "Idle",
      routeTimer: route ? hms(route.totalDuration) : "—",
      routeLeftText: hasActive
        ? etaSec != null
          ? `${formatEta(etaSec)} to next stop`
          : "En route"
        : "Awaiting dispatch",
      stopsLeft: active.length,
      routeProgressPct: totalStops > 0 ? Math.round((doneStops / totalStops) * 100) : 0,
      // last_speed is m/s (W3C Geolocation / fake-gps); display as km/h.
      speedText: v.last_speed != null ? `${Math.round(v.last_speed * 3.6)} km/h` : "—",
      capacityPct: assumed.capacityPct,
      loadCount: assumed.loadCount,
      loadWeight: assumed.loadWeight,
      driver: assumed.driver,
      plate: assumed.plate,
      model: assumed.model,
      odometer: assumed.odometer,
      fuelPct: assumed.fuelPct,
      cargoTemp: assumed.cargoTemp,
    } satisfies ConsoleVehicle
  })

  return built.sort((a, b) => a.reg.localeCompare(b.reg))
}
