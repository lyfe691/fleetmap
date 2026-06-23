"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { isActive } from "@/components/map/fleet-format"
import { useFleetRoutes, type RouteJob } from "@/lib/use-fleet-routes"
import { useLiveStops } from "@/lib/use-live-stops"
import { useLiveVehicles } from "@/lib/use-live-vehicles"
import { useNow } from "@/lib/use-now"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { usePersistedBoolean } from "@/lib/use-persisted-boolean"
import { buildConsoleVehicles } from "@/lib/console/use-console-data"
import type {
  ConsoleView,
  DetailTab,
  LiveData,
  StatusFilter,
} from "@/lib/console/types"
import { ConsoleLoading } from "@/components/console/console-loading"
import { AppSidebar } from "@/components/console/app-sidebar"
import { FleetRail } from "@/components/console/fleet-rail"
import { MapView } from "@/components/console/map-view"
import { TrackingView } from "@/components/console/tracking-view"
import { HistoryView } from "@/components/console/history-view"

export function ConsoleShell({ displayCode }: { displayCode: string }) {
  const { vehicles, error, ready, loaded } = useLiveVehicles(displayCode)
  const { stopsByVehicle } = useLiveStops(ready)
  const now = useNow(5000)

  const jobs: RouteJob[] = useMemo(() => {
    const out: RouteJob[] = []
    for (const [vehicleId, stops] of stopsByVehicle) {
      const act = stops.filter(isActive)
      if (act.length === 0) continue
      out.push({
        vehicleId,
        stopsKey: act.map((s) => `${s.id}:${s.seq}:${s.status}`).join("|"),
      })
    }
    return out
  }, [stopsByVehicle])
  const routes = useFleetRoutes(jobs)

  const live: LiveData = useMemo(
    () => ({ vehicles, stopsByVehicle, routes, now }),
    [vehicles, stopsByVehicle, routes, now]
  )
  const consoleVehicles = useMemo(() => buildConsoleVehicles(live), [live])

  const [view, setView] = useState<ConsoleView>("tracking")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>("Overview")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")

  useEffect(() => {
    setTab("Overview")
  }, [selectedId])
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedBoolean(
    "fleetmap.sidebar-collapsed",
    false
  )
  const [railCollapsed, setRailCollapsed] = usePersistedBoolean(
    "fleetmap.fleet-collapsed",
    false
  )

  // explicit = the user's actual pick (null until they choose / after "view
  // all"); selected = that, falling back to the first van for views that always
  // need one (tracking detail + rail highlight). The map uses `explicit` so a
  // cleared selection means "show the whole fleet".
  const explicit = consoleVehicles.find((v) => v.id === selectedId) ?? null
  const selected = explicit ?? consoleVehicles[0] ?? null

  const counts = useMemo(
    () => ({
      all: consoleVehicles.length,
      onRoute: consoleVehicles.filter((v) => v.tone === "onRoute").length,
      waiting: consoleVehicles.filter((v) => v.tone === "waiting").length,
      online: consoleVehicles.filter((v) => !v.stale).length,
    }),
    [consoleVehicles]
  )

  // Hold the loader until the first snapshot resolves or a connection error
  // surfaces — so the empty "no vehicles" state never flashes before data, and
  // a dead channel falls through to the shell's error banner instead of hanging.
  if (!loaded && !error) return <ConsoleLoading />

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <AppSidebar
        view={view}
        onNavigate={setView}
        onlineCount={counts.online}
        totalCount={counts.all}
        onRouteCount={counts.onRoute}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
      />

      <FleetRail
        vehicles={consoleVehicles}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
        statusFilter={statusFilter}
        onStatusFilter={setStatusFilter}
        counts={counts}
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((c) => !c)}
      />

      <main className="relative min-w-0 flex-1">
        {error ? (
          <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-destructive/40 bg-card px-5 py-3 text-[15px] shadow-md">
            <span className="text-destructive">{error}</span>
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
          </div>
        ) : null}

        {view === "tracking" ? (
          selected ? (
            <TrackingView
              vehicle={selected}
              live={live}
              tab={tab}
              onTab={setTab}
              onLocate={() => setView("map")}
            />
          ) : (
            <EmptyMain label="No vehicles to track yet" />
          )
        ) : null}

        {view === "map" ? (
          <MapView
            live={live}
            selected={explicit}
            selectedId={selectedId}
            onSelectVehicle={setSelectedId}
            onClearSelection={() => setSelectedId(null)}
            onShowDetails={() => setView("tracking")}
          />
        ) : null}

        {view === "history" ? <HistoryView /> : null}
      </main>
    </div>
  )
}

function EmptyMain({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
