"use client"

import { ArrowRight } from "lucide-react"
import { FleetMapView } from "@/components/map/fleet-map-view"
import type { LiveData } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { StatusBadge } from "@/components/console/status-badge"

export function MapView({
  live,
  selected,
  selectedId,
  onSelectVehicle,
  onShowDetails,
}: {
  live: LiveData
  selected: ConsoleVehicle | null
  selectedId: string | null
  onSelectVehicle: (id: string) => void
  onShowDetails: () => void
}) {
  return (
    <div className="relative h-full w-full">
      <FleetMapView
        vehicles={live.vehicles}
        stopsByVehicle={live.stopsByVehicle}
        routes={live.routes}
        now={live.now}
        selectedId={selectedId}
        onSelectVehicle={onSelectVehicle}
      />
      {selected ? (
        <SummaryCard vehicle={selected} onShowDetails={onShowDetails} />
      ) : null}
    </div>
  )
}

function SummaryCard({
  vehicle,
  onShowDetails,
}: {
  vehicle: ConsoleVehicle
  onShowDetails: () => void
}) {
  return (
    <div className="absolute top-6 left-6 z-10 w-[320px] rounded-[20px] border border-border bg-surface p-5 shadow-md">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[17px] font-semibold">{vehicle.reg}</span>
        <StatusBadge tone={vehicle.tone} label={vehicle.statusLabel} />
      </div>

      <div className="mt-4 flex gap-[18px]">
        <Stat label="Speed" value={vehicle.speedText} />
        <Stat label="ETA" value={vehicle.etaText} />
        <Stat label="Load" value={`${vehicle.capacityPct}%`} note />
      </div>

      <div className="mt-4 flex items-center gap-2.5 text-[13.5px]">
        <span className="truncate text-muted-foreground">{vehicle.origin}</span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-semibold">{vehicle.dest}</span>
      </div>

      <button
        type="button"
        onClick={onShowDetails}
        className="mt-4.5 flex h-[46px] w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-md transition-[filter] active:brightness-90"
      >
        View Vehicle Details
        <ArrowRight className="size-4" />
      </button>
    </div>
  )
}

function Stat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: boolean
}) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
        {note ? <span title="Placeholder value">*</span> : null}
      </div>
      <div className="mt-0.5 font-mono text-[19px] font-semibold">{value}</div>
    </div>
  )
}
