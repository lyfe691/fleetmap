import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"

export type ConsoleView = "tracking" | "map" | "history"
export type StatusFilter = "All" | "On Route" | "Waiting" | "Late"

export function matchesStatusFilter(
  v: Pick<ConsoleVehicle, "tone" | "late">,
  filter: StatusFilter
): boolean {
  if (filter === "All") return true
  if (filter === "On Route") return v.tone === "onRoute"
  if (filter === "Waiting") return v.tone === "waiting"
  return v.late // "Late"
}

export type ConsoleCounts = {
  all: number
  onRoute: number
  waiting: number
  late: number
  online: number
}

export type LiveData = {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
}
