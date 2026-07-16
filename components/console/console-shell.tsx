"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useFleetRoutes, type RouteJob } from "@/lib/use-fleet-routes"
import { useLiveStops } from "@/lib/use-live-stops"
import { useLiveVehicles } from "@/lib/use-live-vehicles"
import { useNow } from "@/lib/use-now"
import { LIVE_TICK_MS } from "@/lib/console/intervals"
import { usePersistedBoolean } from "@/lib/use-persisted-boolean"
import { buildConsoleVehicles } from "@/lib/console/use-console-data"
import type { ConsoleView, LiveData, StatusFilter } from "@/lib/console/types"
import { matchesStatusFilter } from "@/lib/console/types"
import { ConsoleLoading } from "@/components/console/console-loading"
import { AppSidebar } from "@/components/console/app-sidebar"
import { FleetRail } from "@/components/console/fleet-rail"
import { MapView } from "@/components/console/map-view"
import { TrackingView } from "@/components/console/tracking-view"
import { HistoryView } from "@/components/console/history-view"
import { SettingsDialog } from "@/components/console/settings/settings-dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { translate, useLocale, useTranslations } from "@/lib/i18n"
import { Truck } from "lucide-react"

export function ConsoleShell({ onChangeCode }: { onChangeCode: () => void }) {
  const { vehicles, error, ready, loaded, serverOffsetMs } = useLiveVehicles()
  const { stopsByVehicle, error: stopsError } = useLiveStops(ready)
  // Server-aligned clock: `now` only feeds staleness math, so subtract the
  // estimated TV-vs-server skew. The sidebar wall clock stays on local time.
  const now = useNow(LIVE_TICK_MS) - serverOffsetMs

  // The full-day route is a function of the stop SET only (ids · positions ·
  // seq — matching /api/route), so the cache key deliberately excludes status:
  // a stop completing must not refetch an identical line. Vans with only
  // terminal stops keep their (fully grey) day line until the snapshot's 24 h
  // bound drops the stops themselves.
  const jobs: RouteJob[] = useMemo(() => {
    const out: RouteJob[] = []
    for (const [vehicleId, stops] of stopsByVehicle) {
      if (stops.length === 0) continue
      out.push({
        vehicleId,
        stopsKey: stops
          .map((s) => `${s.id}:${s.seq}:${s.lat}:${s.lng}`)
          .join("|"),
      })
    }
    return out
  }, [stopsByVehicle])
  const routes = useFleetRoutes(jobs)

  const live: LiveData = useMemo(
    () => ({ vehicles, stopsByVehicle, routes, now }),
    [vehicles, stopsByVehicle, routes, now]
  )
  const locale = useLocale()
  const consoleVehicles = useMemo(
    () =>
      buildConsoleVehicles(live, (key, params) =>
        translate(locale, key, params)
      ),
    [live, locale]
  )

  // Map is the TV home: ambient fleet view works with no selection. Tracking
  // and History need an explicit rail pick (see EmptyMain).
  const [view, setView] = useState<ConsoleView>("map")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")

  // A vanished vehicle can't stay selected: focus mode would dim the whole
  // fleet with nothing in focus.
  useEffect(() => {
    if (selectedId != null && !vehicles.some((v) => v.id === selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, vehicles])

  const handleStatusFilter = (filter: StatusFilter) => {
    setStatusFilter(filter)
    if (selectedId != null) {
      const sel = consoleVehicles.find((v) => v.id === selectedId)
      if (sel && !matchesStatusFilter(sel, filter)) setSelectedId(null)
    }
  }

  const t = useTranslations()

  const [settingsOpen, setSettingsOpen] = useState(false)

  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedBoolean(
    "fleetmap.sidebar-collapsed",
    false
  )
  const [railCollapsed, setRailCollapsed] = usePersistedBoolean(
    "fleetmap.fleet-collapsed",
    false
  )
  // Selection is always explicit: the fleet rail is the van picker. No silent
  // fall-back to the first van — Tracking/History empty-state until a card is
  // tapped; the map treats null as "whole fleet" (view all).
  const selected = consoleVehicles.find((v) => v.id === selectedId) ?? null

  const counts = useMemo(
    () => ({
      all: consoleVehicles.length,
      onRoute: consoleVehicles.filter((v) => v.tone === "onRoute").length,
      waiting: consoleVehicles.filter((v) => v.tone === "waiting").length,
      online: consoleVehicles.filter((v) => !v.stale).length,
    }),
    [consoleVehicles]
  )

  // Open the fleet rail when a pick becomes necessary — entering Tracking/
  // History without a selection, or vans first appearing while already on
  // those views with nothing selected. Do NOT re-expand when the operator
  // clears selection (they may have collapsed the rail on purpose).
  // Map-as-default softens cold-load, but does not cover map → tracking/history
  // before the snapshot lands, so fleet 0→N still needs a reaction.
  const prevViewRef = useRef(view)
  const prevFleetLenRef = useRef(0)
  useEffect(() => {
    const needsPick =
      (view === "tracking" || view === "history") &&
      selectedId == null &&
      consoleVehicles.length > 0

    const enteredPickView =
      prevViewRef.current !== view &&
      (view === "tracking" || view === "history")
    const fleetArrived =
      prevFleetLenRef.current === 0 && consoleVehicles.length > 0

    if (needsPick && (enteredPickView || fleetArrived)) {
      setRailCollapsed(false)
    }

    prevViewRef.current = view
    prevFleetLenRef.current = consoleVehicles.length
  }, [view, selectedId, consoleVehicles.length])

  // Hold the loader until the first snapshot resolves (or a snapshot/auth error
  // surfaces) so the empty "no vehicles" state never flashes before data. The
  // snapshot is independent of the live socket, so a stalled channel can't hang
  // this — it releases on the select, and live updates layer on afterwards.
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
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <FleetRail
        vehicles={consoleVehicles}
        selectedId={selectedId}
        onSelect={setSelectedId}
        statusFilter={statusFilter}
        onStatusFilter={handleStatusFilter}
        counts={counts}
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((c) => !c)}
      />

      <main className="relative min-w-0 flex-1">
        {(error ?? stopsError) ? (
          <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-destructive/40 bg-card px-5 py-3 text-[0.9375rem] shadow-md">
            <span className="text-destructive">{error ?? stopsError}</span>
            <Button variant="outline" size="sm" onClick={onChangeCode}>
              {t("shell.changeCode")}
            </Button>
          </div>
        ) : null}

        {view === "tracking" ? (
          selected ? (
            <TrackingView
              vehicle={selected}
              live={live}
              onLocate={() => setView("map")}
            />
          ) : (
            <EmptyMain
              title={
                consoleVehicles.length === 0
                  ? t("shell.noVehiclesTitle")
                  : t("shell.pickVehicleTitle")
              }
              description={
                consoleVehicles.length === 0
                  ? t("shell.noVehicles")
                  : t("shell.pickVehicle")
              }
            />
          )
        ) : null}

        {view === "map" ? (
          <MapView
            live={live}
            selected={selected}
            selectedId={selectedId}
            onSelectVehicle={setSelectedId}
            onClearSelection={() => setSelectedId(null)}
            onShowDetails={() => setView("tracking")}
          />
        ) : null}

        {view === "history" ? (
          <HistoryView
            vehicleId={selected?.id ?? null}
            vehicleReg={selected?.reg ?? null}
          />
        ) : null}
      </main>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

// Same Empty pattern as the stop-less itinerary in TrackingView — keep
// console empty states on one component family.
function EmptyMain({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Empty className="max-w-md border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Truck />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
