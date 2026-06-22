"use client"

import { ArrowRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import type { ConsoleCounts, StatusFilter } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { StatusBadge } from "@/components/console/status-badge"

const SEGMENTS: { label: StatusFilter; key: keyof ConsoleCounts }[] = [
  { label: "All", key: "all" },
  { label: "On Route", key: "onRoute" },
  { label: "Waiting", key: "waiting" },
]

export function FleetRail({
  vehicles,
  selectedId,
  onSelect,
  statusFilter,
  onStatusFilter,
  counts,
  collapsed,
  onToggleCollapse,
}: {
  vehicles: ConsoleVehicle[]
  selectedId: string | null
  onSelect: (id: string) => void
  statusFilter: StatusFilter
  onStatusFilter: (filter: StatusFilter) => void
  counts: ConsoleCounts
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  if (collapsed) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-4 border-r border-border bg-background py-4">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand fleet panel"
          className="flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronsRight className="size-5" />
        </button>
        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[15px] font-semibold">{counts.all}</span>
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase [writing-mode:vertical-rl]">
            Fleet
          </span>
        </div>
      </aside>
    )
  }

  const filtered = vehicles.filter((v) =>
    statusFilter === "All"
      ? true
      : statusFilter === "On Route"
        ? v.tone === "onRoute"
        : v.tone === "waiting"
  )

  return (
    <section className="flex h-full w-[380px] shrink-0 flex-col border-r border-border bg-background">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-heading text-[28px] font-semibold tracking-tight">
              Fleet
            </h1>
            <span className="text-[15px] text-muted-foreground">
              {counts.all} vehicles
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse fleet panel"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronsLeft className="size-5" />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {SEGMENTS.map((seg) => {
            const active = statusFilter === seg.label
            return (
              <button
                key={seg.label}
                type="button"
                onClick={() => onStatusFilter(seg.label)}
                aria-pressed={active}
                className={`flex h-[54px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border text-[15px] font-semibold transition-[filter] active:brightness-95 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {seg.label}
                <span className="font-medium opacity-65">{counts[seg.key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-1 pb-5">
        <div className="flex flex-col gap-3">
          {filtered.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              selected={v.id === selectedId}
              onSelect={() => onSelect(v.id)}
            />
          ))}
          {filtered.length === 0 ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">
              No vehicles
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function VehicleCard({
  vehicle,
  selected,
  onSelect,
}: {
  vehicle: ConsoleVehicle
  selected: boolean
  onSelect: () => void
}) {
  const onRoute = vehicle.tone === "onRoute"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-[18px] border-2 bg-card p-[18px] text-left transition-[transform,border-color,box-shadow] duration-150 active:scale-[0.985] ${
        selected ? "border-primary shadow-md" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[15px] font-semibold">{vehicle.reg}</span>
        <StatusBadge tone={vehicle.tone} label={vehicle.statusLabel} />
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[26px] leading-none font-semibold tracking-tight">
            {onRoute ? vehicle.etaText : "Idle"}
          </div>
          <div className="mt-1.5 text-[14px] text-muted-foreground">
            {onRoute
              ? `${vehicle.stopsLeft} stop${vehicle.stopsLeft === 1 ? "" : "s"} left`
              : "Awaiting dispatch"}
            {vehicle.stale ? " · stale" : ""}
          </div>
          <div className="mt-3.5 flex items-center gap-2 text-[14px]">
            <span className="max-w-[92px] truncate text-muted-foreground">
              {vehicle.origin}
            </span>
            <ArrowRight className="size-[18px] shrink-0 text-muted-foreground" />
            <span className="max-w-[92px] truncate font-semibold">
              {vehicle.dest}
            </span>
          </div>
        </div>
        <div className="flex h-[76px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bubblebox-van.png"
            alt=""
            draggable={false}
            className="h-full w-full object-contain p-1.5"
          />
        </div>
      </div>
    </button>
  )
}
