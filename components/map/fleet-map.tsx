"use client"

import { useMemo } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { useFleetRoutes, type RouteJob } from "@/lib/use-fleet-routes"
import { useLiveStops } from "@/lib/use-live-stops"
import { useLiveVehicles } from "@/lib/use-live-vehicles"
import { useOperationalAreas } from "@/lib/use-operational-areas"
import { useNow } from "@/lib/use-now"
import { isActive } from "@/components/map/fleet-format"
import { FleetMapView } from "@/components/map/fleet-map-view"
import { FleetRail } from "@/components/map/fleet-rail"

export function FleetMap({ displayCode }: { displayCode: string }) {
  const { vehicles, error, ready } = useLiveVehicles(displayCode)
  const { stopsByVehicle } = useLiveStops(ready)
  const { areas } = useOperationalAreas(ready)
  const now = useNow(5000)

  const jobs: RouteJob[] = useMemo(() => {
    const out: RouteJob[] = []
    for (const [vehicleId, stops] of stopsByVehicle) {
      const active = stops.filter(isActive)
      if (active.length === 0) continue
      out.push({
        vehicleId,
        stopsKey: active.map((s) => `${s.id}:${s.seq}:${s.status}`).join("|"),
      })
    }
    return out
  }, [stopsByVehicle])

  const routes = useFleetRoutes(jobs)

  return (
    <div className="flex h-full w-full">
      <div className="relative h-full flex-1">
        {error ? (
          <Alert
            variant="destructive"
            className="absolute top-4 left-4 z-10 w-auto max-w-sm shadow-md"
          >
            <AlertDescription className="flex items-center gap-3">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearDisplayCode()
                  window.location.reload()
                }}
              >
                Change code
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <FleetMapView
          vehicles={vehicles}
          stopsByVehicle={stopsByVehicle}
          routes={routes}
          areas={areas}
          now={now}
        />
      </div>

      <FleetRail
        vehicles={vehicles}
        stopsByVehicle={stopsByVehicle}
        routes={routes}
        areas={areas}
        now={now}
      />
    </div>
  )
}
