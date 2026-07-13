"use client"

import type { CSSProperties } from "react"
import { ArrowRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import type { ConsoleCounts, StatusFilter } from "@/lib/console/types"
import { matchesStatusFilter } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { StatusBadge } from "@/components/console/status-badge"
import { useTranslations, useLocale } from "@/lib/i18n"
import { formatCount } from "@/lib/i18n/format"
import type { TranslationKey } from "@/lib/i18n/en"
import { Card, CardContent } from "@/components/ui/card"
import { PillTabs } from "@/components/ui/pill-tabs"
import { cn } from "@/lib/utils"

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
          <span className="font-mono text-[0.9375rem] font-semibold">{formatCount(counts.all, locale)}</span>
          <span className="text-[0.75rem] font-medium tracking-wider text-muted-foreground uppercase [writing-mode:vertical-rl]">
            {t("rail.fleet")}
          </span>
        </div>
      </aside>
    )
  }

  const filtered = vehicles.filter((v) => matchesStatusFilter(v, statusFilter))

  return (
    <section className="flex h-full w-[23.75rem] shrink-0 flex-col border-r border-border bg-background">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="font-heading text-[1.625rem] leading-none font-semibold tracking-tight">
              {t("rail.fleet")}
            </h1>
            <p className="mt-2 text-[0.875rem] text-muted-foreground">
              {t(counts.all === 1 ? "rail.vehicles.one" : "rail.vehicles.other", { n: formatCount(counts.all, locale) })}
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={t("rail.collapsePanel")}
            className="-mt-1 -mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground"
          >
            <ChevronsLeft className="size-5" />
          </button>
        </div>

        <PillTabs
          className="mt-5 flex w-full"
          activeId={statusFilter}
          onTabChange={(id) => onStatusFilter(id as StatusFilter)}
          tabs={SEGMENTS.map((seg) => ({
            id: seg.filter,
            ariaLabel: t(seg.tKey),
            label: (
              <>
                {t(seg.tKey)}
                <span className="opacity-55">
                  {formatCount(counts[seg.key], locale)}
                </span>
              </>
            ),
          }))}
        />
      </div>

      <div
        className="flex-1 overflow-y-auto px-5 pt-2 pb-6"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 24px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0, #000 14px, #000 calc(100% - 24px), transparent 100%)",
        }}
      >
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

function StaleChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[0.75rem] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-warning" />
      {label}
    </span>
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
    <Card
      size="sm"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "w-full cursor-pointer gap-0 text-left transition-[scale] duration-200 ease-out active:scale-[0.97]",
        // Selected: rotating conic border tinted to the vehicle's status colour
        // (see .fleet-card-selected in globals.css). ring-0 kills Card's default
        // hairline so the border technique owns the edge.
        selected && "fleet-card-selected ring-0"
      )}
      style={
        selected
          ? ({ "--sel-accent": onRoute ? "var(--success)" : "var(--warning)" } as CSSProperties)
          : undefined
      }
    >
      <CardContent>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">
            {vehicle.reg}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusBadge tone={vehicle.tone} />
            {vehicle.stale ? <StaleChip label={t("rail.stale")} /> : null}
          </div>
        </div>

        <div className="mt-3.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {onRoute ? (
              <>
                <div className="font-mono text-[1.625rem] leading-none font-semibold tracking-tight">
                  {vehicle.etaText}
                </div>
                <div className="mt-1.5 text-[0.875rem] text-muted-foreground">
                  {vehicle.stopsLeft === 1
                    ? t("rail.stopsLeft.one", { n: vehicle.stopsLeft })
                    : t("rail.stopsLeft.other", { n: vehicle.stopsLeft })}
                </div>
                <div className="mt-3.5 flex items-center gap-2 text-[0.875rem]">
                  <span className="max-w-[5.75rem] truncate text-muted-foreground">
                    {vehicle.origin}
                  </span>
                  <ArrowRight className="size-[18px] shrink-0 text-muted-foreground" />
                  <span className="max-w-[5.75rem] truncate font-semibold">
                    {vehicle.dest}
                  </span>
                </div>
              </>
            ) : (
              <div className="font-mono text-[1.625rem] leading-none font-semibold tracking-tight text-muted-foreground">
                {t("rail.idle")}
              </div>
            )}
          </div>
          <div className="flex h-[4.75rem] w-[7rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bubblebox-van.png"
              alt=""
              draggable={false}
              className="h-full w-full object-contain p-1.5"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
