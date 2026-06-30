"use client"

import { ArrowRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FleetMapView } from "@/components/map/fleet-map-view"
import type { LiveData } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { StatusBadge } from "@/components/console/status-badge"
import { useTranslations } from "@/lib/i18n"

export function MapView({
  live,
  selected,
  selectedId,
  onSelectVehicle,
  onClearSelection,
  onShowDetails,
}: {
  live: LiveData
  selected: ConsoleVehicle | null
  selectedId: string | null
  onSelectVehicle: (id: string) => void
  onClearSelection: () => void
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
        <SummaryCard
          vehicle={selected}
          onShowDetails={onShowDetails}
          onClose={onClearSelection}
        />
      ) : null}
    </div>
  )
}

function SummaryCard({
  vehicle,
  onShowDetails,
  onClose,
}: {
  vehicle: ConsoleVehicle
  onShowDetails: () => void
  onClose: () => void
}) {
  const t = useTranslations()
  return (
    <div className="absolute top-6 left-6 z-10 w-[22.5rem] rounded-2xl border border-border bg-surface p-6 shadow-lg">
      {/* Header: name + status stack on the left (each on its own row so a long
          name and the status never collide), close button pinned top-right. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[1.125rem] leading-tight font-semibold">
            {vehicle.reg}
          </h2>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge tone={vehicle.tone} size="sm" />
            {vehicle.stale ? (
              <span className="text-[0.8125rem] font-medium text-muted-foreground">
                {t("card.stale")}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("card.viewAll")}
          title={t("card.viewAll")}
          className="-mt-1 -mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className={`mt-6 flex gap-6 ${vehicle.stale ? "opacity-60" : ""}`}>
        <Stat label={t("card.speed")} value={vehicle.speedText} />
        <Stat label={t("card.eta")} value={vehicle.etaText} />
        <Stat label={t("card.load")} value={`${vehicle.capacityPct}%`} note={t("card.loadNote")} />
      </div>

      <div className="mt-6 flex items-center gap-2.5 text-[0.9375rem]">
        <span className="max-w-[45%] truncate text-muted-foreground">
          {vehicle.origin}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        <span className="max-w-[45%] truncate font-semibold">
          {vehicle.dest}
        </span>
      </div>

      <Button
        onClick={onShowDetails}
        className="mt-6 h-14 w-full gap-2 rounded-2xl text-[1rem] font-semibold"
      >
        {t("card.viewDetails")}
        <ArrowRight className="size-5" />
      </Button>
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
  note?: string
}) {
  return (
    <div>
      <div className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
        {note ? <span title={note}>*</span> : null}
      </div>
      <div className="mt-1 font-mono text-[1.25rem] font-semibold">{value}</div>
    </div>
  )
}
