import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"

export type ConsoleView = "tracking" | "map" | "history"
export type StatusFilter = "All" | "On Route" | "Waiting"
export type DetailTab = "Overview" | "Vehicle" | "Cargo"

export type ConsoleCounts = {
  all: number
  onRoute: number
  waiting: number
  online: number
}

export type LiveData = {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
}
