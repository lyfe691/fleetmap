"use client"

import { type CSSProperties, useEffect, useMemo, useRef } from "react"
import { Check, MapPin } from "lucide-react"
import { FleetMapView } from "@/components/map/fleet-map-view"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { LiveData } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import type { Stop } from "@/lib/use-live-stops"
import type { TranslationKey } from "@/lib/i18n/en"
import type { Locale } from "@/lib/settings/types"
import { StatusBadge } from "@/components/console/status-badge"
import { useLocale, useTranslations } from "@/lib/i18n"
import { formatClock } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"

export function TrackingView({
  vehicle,
  live,
  onLocate,
}: {
  vehicle: ConsoleVehicle
  live: LiveData
  onLocate: () => void
}) {
  const t = useTranslations()
  const locale = useLocale()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Switching vehicles resets to the top — the previous scroll position carries
  // no meaning for a different van.
  const prevId = useRef(vehicle.id)
  useEffect(() => {
    if (prevId.current === vehicle.id) return
    prevId.current = vehicle.id
    scrollRef.current?.scrollTo({ top: 0 })
  }, [vehicle.id])

  const stops = useMemo(
    () => live.stopsByVehicle.get(vehicle.id) ?? [],
    [live.stopsByVehicle, vehicle.id]
  )
  const nextStopId = useMemo(
    () => stops.find((s) => s.status !== "completed")?.id ?? null,
    [stops]
  )
  const statusAccent =
    vehicle.tone === "onRoute" ? "var(--success)" : "var(--warning)"

  const miniLive: LiveData = useMemo(() => {
    const raw = live.vehicles.find((v) => v.id === vehicle.id)
    const route = live.routes.get(vehicle.id)
    return {
      vehicles: raw ? [raw] : [],
      stopsByVehicle: raw ? new Map([[vehicle.id, stops]]) : new Map(),
      routes: route ? new Map([[vehicle.id, route]]) : new Map(),
      now: live.now,
    }
  }, [vehicle.id, live, stops])

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scroll-smooth">
      <div className="mx-auto max-w-[75rem] px-8 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-4 pt-7">
          <div className="flex min-w-0 items-center gap-3.5">
            <h2 className="text-[1.75rem] leading-none font-semibold tracking-tight">
              {vehicle.reg}
            </h2>
            <StatusBadge tone={vehicle.tone} size="md" />
            {vehicle.stale ? (
              <span className="text-[0.9375rem] font-medium text-muted-foreground">
                {t("card.stale")}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onLocate}
            className="flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-[1rem] font-semibold text-primary-foreground shadow-md transition-[filter] active:brightness-90"
          >
            <MapPin className="size-5" />
            {t("tracking.locateOnMap")}
          </button>
        </header>

        <div className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription className="text-[0.875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {t("card.load")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-heading text-[3.25rem] leading-none font-bold tracking-tight tabular-nums">
                    {vehicle.ordersOnboard}
                  </span>
                  <span className="text-[0.9375rem] text-muted-foreground">
                    {t("tracking.orders")}
                  </span>
                </div>
                <div className="mt-4 flex gap-6">
                  <MiniFigure label={t("tracking.collected")} value={vehicle.collected} />
                  <MiniFigure label={t("tracking.delivered")} value={vehicle.delivered} />
                </div>
              </div>
              <div className="flex h-[6.5rem] w-[9.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/bubblebox-van-tight.png"
                  alt=""
                  draggable={false}
                  className="h-full w-full object-contain p-1.5"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription className="text-[0.875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {t("tracking.routeProgress")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <div className="font-mono text-[2.5rem] leading-none font-semibold tracking-tight">
                {vehicle.routeTimer}
              </div>
              <p className="mt-2 text-[0.9375rem] text-muted-foreground">
                {vehicle.routeLeftText}
              </p>
              <div className="mt-auto flex items-center gap-3 pt-5 text-[0.9375rem]">
                <span className="text-muted-foreground">{vehicle.origin}</span>
                <div className="relative h-1 flex-1 rounded-full bg-muted">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-primary"
                    style={{ width: `${vehicle.routeProgressPct}%` }}
                  />
                </div>
                <span className="font-semibold">{vehicle.dest}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <StatCard label={t("tracking.currentSpeed")} value={vehicle.speedText} />
          <StatCard label={t("card.eta")} value={vehicle.etaText} />
          <StatCard label={t("tracking.stopsLeft")} value={String(vehicle.stopsLeft)} />
        </div>

        <h3 className="mt-8 font-heading text-xl font-semibold tracking-tight">
          {t("tracking.itinerary")}
        </h3>
        <Card className="mt-4 py-0">
          <div className="divide-y divide-border">
            {stops.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                {t("tracking.noStops")}
              </p>
            ) : (
              stops.map((s) => (
                <StopRow
                  key={s.id}
                  stop={s}
                  isNext={s.id === nextStopId}
                  accent={statusAccent}
                  locale={locale}
                  t={t}
                />
              ))
            )}
          </div>
        </Card>

        <h3 className="mt-8 font-heading text-xl font-semibold tracking-tight">
          {t("tracking.liveLocation")}
        </h3>
        {/* Viewport-relative so the map grows with the screen instead of sitting at
            a fixed island on a big wall TV — floored/capped to stay sane on laptops
            and very tall displays. */}
        <div className="mt-4 h-[clamp(420px,52vh,760px)] overflow-hidden rounded-2xl border border-border shadow-[var(--shadow-card)]">
          <FleetMapView
            vehicles={miniLive.vehicles}
            stopsByVehicle={miniLive.stopsByVehicle}
            routes={miniLive.routes}
            now={miniLive.now}
            showChrome={false}
            follow
          />
        </div>
      </div>
    </div>
  )
}

function MiniFigure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[0.75rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[1.25rem] font-semibold tabular-nums">
        {value}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-[1.375rem] font-semibold tracking-tight">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

function StopRow({
  stop,
  isNext,
  accent,
  locale,
  t,
}: {
  stop: Stop
  isNext: boolean
  accent: string
  locale: Locale
  t: (key: TranslationKey) => string
}) {
  const done = stop.status === "completed"
  const typeLabel = t(
    stop.stop_type === "pickup" ? "dispatch.stop.pickup" : "dispatch.stop.dropoff"
  )
  const statusKey: TranslationKey =
    stop.status === "completed"
      ? "dispatch.status.completed"
      : stop.status === "arrived"
        ? "dispatch.status.arrived"
        : "dispatch.status.planned"
  const eta = stop.eta_at ? formatClock(Date.parse(stop.eta_at), locale) : "—"

  return (
    <div className={cn("flex items-center gap-4 px-5 py-4", done && "opacity-55")}>
      <StopMarker done={done} next={isNext} accent={accent} />
      <div className="min-w-0 flex-1">
        <div className="text-[0.9375rem] font-semibold">{typeLabel}</div>
        <div className="mt-0.5 text-[0.8125rem] text-muted-foreground">{t(statusKey)}</div>
      </div>
      <div className="shrink-0 font-mono text-[0.9375rem] font-semibold tabular-nums">
        {eta}
      </div>
    </div>
  )
}

function StopMarker({
  done,
  next,
  accent,
}: {
  done: boolean
  next: boolean
  accent: string
}) {
  if (done) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="size-4" />
      </span>
    )
  }
  if (next) {
    return (
      <span
        className="stop-next-ring flex size-7 shrink-0 items-center justify-center rounded-full"
        style={{ "--sel-accent": accent } as CSSProperties}
      >
        <span className="size-1.5 rounded-full" style={{ background: accent }} />
      </span>
    )
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-border text-muted-foreground">
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  )
}
