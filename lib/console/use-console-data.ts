import { isActive } from "@/components/map/fleet-format"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import type { TranslationKey } from "@/lib/i18n/en"
import { isStale } from "@/components/map/vehicle-marker"
import {
  assessLateness,
  remainingDriveSeconds,
  snapFraction,
} from "@/lib/schedule"
import { ASSUMED_ORIGIN } from "@/lib/console/assumed"

export type Translator = (
  key: TranslationKey,
  params?: Record<string, string | number>
) => string

export type StatusTone = "onRoute" | "waiting"

export type ConsoleVehicle = {
  id: string
  reg: string
  tone: StatusTone
  statusLabel: string
  stale: boolean
  late: boolean // behind schedule vs the next stop's eta_at (+ grace)
  nextStopProjectedMs: number | null // projected arrival at the next stop
  origin: string
  dest: string
  etaText: string
  routeTimer: string
  routeLeftText: string
  stopsLeft: number
  routeProgressPct: number
  speedText: string
  ordersOnboard: number
  collected: number
  delivered: number
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

export function buildConsoleVehicles(
  input: {
    vehicles: Vehicle[]
    stopsByVehicle: Map<string, Stop[]>
    routes: Map<string, Route>
    now: number
  },
  t: Translator
): ConsoleVehicle[] {
  const { vehicles, stopsByVehicle, routes, now } = input

  const built = vehicles.map((v) => {
    const stops = stopsByVehicle.get(v.id) ?? []
    const active = stops.filter(isActive)
    const hasActive = active.length > 0
    const next = active[0] ?? null
    const route = routes.get(v.id)

    const stale = isStale(v.last_seen_at, now)
    // Schedule math off the full-day route: the van's snap along the line
    // scales the current leg, full legs ahead count whole. If the next stop
    // isn't on the route yet (async refetch after a stop change) the estimate
    // is null — show "—" rather than a wrong ETA.
    const fraction =
      route && v.last_lng != null && v.last_lat != null
        ? snapFraction(route.geometry, [v.last_lng, v.last_lat])
        : null
    const lateness = assessLateness({ route, stops, fraction, now })
    const etaSec = lateness.remainingDriveSec
    const lastStopId = route?.stopOffsets[route.stopOffsets.length - 1]?.stopId
    const dayLeftSec =
      route && fraction != null && lastStopId != null
        ? remainingDriveSeconds(route, fraction, lastStopId)
        : (route?.totalDuration ?? null)
    const totalStops = stops.length
    const doneStops = Math.max(0, totalStops - active.length)
    const collected = stops.filter(
      (s) => s.stop_type === "pickup" && s.status === "completed"
    ).length
    const delivered = stops.filter(
      (s) => s.stop_type === "dropoff" && s.status === "completed"
    ).length

    return {
      id: v.id,
      reg: v.label ?? v.id.slice(0, 8),
      tone: hasActive ? "onRoute" : "waiting",
      statusLabel: hasActive ? t("filter.onRoute") : t("filter.waiting"),
      stale,
      late: lateness.late,
      nextStopProjectedMs: lateness.projectedArrivalMs,
      origin: ASSUMED_ORIGIN,
      dest: next
        ? t(next.stop_type === "pickup" ? "dispatch.stop.pickup" : "dispatch.stop.dropoff")
        : "—",
      etaText: hasActive ? (etaSec != null ? formatEta(etaSec) : "—") : t("rail.idle"),
      routeTimer: dayLeftSec != null ? hms(dayLeftSec) : "—",
      routeLeftText: hasActive
        ? etaSec != null
          ? t("console.toNextStop", { eta: formatEta(etaSec) })
          : t("console.enRoute")
        : t("rail.awaitingDispatch"),
      stopsLeft: active.length,
      routeProgressPct: totalStops > 0 ? Math.round((doneStops / totalStops) * 100) : 0,
      // last_speed is m/s (W3C Geolocation / fake-gps); display as km/h.
      speedText: v.last_speed != null ? `${Math.round(v.last_speed * 3.6)} km/h` : "—",
      ordersOnboard: Math.max(0, collected - delivered),
      collected,
      delivered,
    } satisfies ConsoleVehicle
  })

  return built.sort((a, b) => a.reg.localeCompare(b.reg))
}
