"use client"

import { ArrowRight, X } from "lucide-react"
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
    <div className="absolute top-6 left-6 z-10 w-[360px] rounded-2xl border border-border bg-surface p-6 shadow-lg">
      {/* Header: name + status stack on the left (each on its own row so a long
          name and the status never collide), close button pinned top-right. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[19px] leading-tight font-semibold">
            {vehicle.reg}
          </h2>
          <div className="mt-2 flex items-center gap-2">
            <StatusBadge tone={vehicle.tone} size="sm" />
            {vehicle.stale ? (
              <span className="text-[13px] font-medium text-muted-foreground">
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
          className="-mt-1 -mr-1.5 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className={`mt-6 flex gap-6 ${vehicle.stale ? "opacity-60" : ""}`}>
        <Stat label={t("card.speed")} value={vehicle.speedText} />
        <Stat label={t("card.eta")} value={vehicle.etaText} />
        <Stat label={t("card.load")} value={`${vehicle.capacityPct}%`} note={t("card.loadNote")} />
      </div>

      <div className="mt-6 flex items-center gap-2.5 text-[15px]">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {vehicle.origin}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-right font-semibold">
          {vehicle.dest}
        </span>
      </div>

      <button
        type="button"
        onClick={onShowDetails}
        className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-[filter] hover:brightness-110 active:brightness-90"
      >
        {t("card.viewDetails")}
        <ArrowRight className="size-[18px]" />
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
  note?: string
}) {
  return (
    <div>
      <div className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
        {note ? <span title={note}>*</span> : null}
      </div>
      <div className="mt-1 font-mono text-[22px] font-semibold">{value}</div>
    </div>
  )
}
