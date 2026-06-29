"use client"

import { ArrowRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import type { ConsoleCounts, StatusFilter } from "@/lib/console/types"
import { matchesStatusFilter } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { StatusBadge } from "@/components/console/status-badge"
import { useTranslations, useLocale } from "@/lib/i18n"
import { formatCount } from "@/lib/i18n/format"
import type { TranslationKey } from "@/lib/i18n/en"

const SEGMENTS: { filter: StatusFilter; key: keyof ConsoleCounts; tKey: TranslationKey }[] = [
  { filter: "All", key: "all", tKey: "filter.all" },
  { filter: "On Route", key: "onRoute", tKey: "filter.onRoute" },
  { filter: "Waiting", key: "waiting", tKey: "filter.waiting" },
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
  const t = useTranslations()
  const locale = useLocale()

  if (collapsed) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-4 border-r border-border bg-background py-4">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={t("rail.expandPanel")}
          className="flex size-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronsRight className="size-5" />
        </button>
        <div className="flex flex-col items-center gap-2">
          <span className="font-mono text-[15px] font-semibold">{formatCount(counts.all, locale)}</span>
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase [writing-mode:vertical-rl]">
            {t("rail.fleet")}
          </span>
        </div>
      </aside>
    )
  }

  const filtered = vehicles.filter((v) => matchesStatusFilter(v, statusFilter))

  return (
    <section className="flex h-full w-[380px] shrink-0 flex-col border-r border-border bg-background">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2.5">
            <h1 className="font-heading text-[28px] font-semibold tracking-tight">
              {t("rail.fleet")}
            </h1>
            <span className="text-[15px] text-muted-foreground">
              {t("rail.vehicles", { n: formatCount(counts.all, locale) })}
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={t("rail.collapsePanel")}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronsLeft className="size-5" />
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {SEGMENTS.map((seg) => {
            const active = statusFilter === seg.filter
            return (
              <button
                key={seg.filter}
                type="button"
                onClick={() => onStatusFilter(seg.filter)}
                aria-pressed={active}
                className={`flex h-[54px] flex-1 items-center justify-center gap-1.5 rounded-[14px] border text-[15px] font-semibold transition-[filter] active:brightness-95 ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {t(seg.tKey)}
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
              {t("rail.noVehicles")}
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
  const t = useTranslations()
  const onRoute = vehicle.tone === "onRoute"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-[18px] border-2 bg-card p-[18px] text-left transition-[transform,border-color,box-shadow] duration-150 active:scale-[0.985] ${
        selected ? "border-primary/35 shadow-sm" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[15px] font-semibold">{vehicle.reg}</span>
        <StatusBadge tone={vehicle.tone} label={vehicle.statusLabel} />
      </div>

      <div className="mt-3.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[26px] leading-none font-semibold tracking-tight">
            {onRoute ? vehicle.etaText : t("rail.idle")}
          </div>
          <div className="mt-1.5 text-[14px] text-muted-foreground">
            {onRoute
              ? vehicle.stopsLeft === 1
                ? t("rail.stopsLeft.one", { n: vehicle.stopsLeft })
                : t("rail.stopsLeft.other", { n: vehicle.stopsLeft })
              : t("rail.awaitingDispatch")}
            {vehicle.stale ? ` · ${t("rail.stale")}` : ""}
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
