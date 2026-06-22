"use client"

import { useMemo } from "react"
import {
  Fuel,
  Gauge,
  ImageIcon,
  MapPin,
  Package,
  Scale,
  Thermometer,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react"
import { FleetMapView } from "@/components/map/fleet-map-view"
import type { DetailTab, LiveData } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { assumedCargoPhotos, assumedManifest } from "@/lib/console/assumed"
import { StatusBadge } from "@/components/console/status-badge"

const TABS: DetailTab[] = ["Overview", "Vehicle", "Cargo"]

export function TrackingView({
  vehicle,
  live,
  tab,
  onTab,
  onLocate,
}: {
  vehicle: ConsoleVehicle
  live: LiveData
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onLocate: () => void
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-[30px] pt-6 pb-11">
        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <div className="flex items-center gap-3">
            <h2 className="font-mono text-[23px] font-semibold tracking-tight">
              {vehicle.reg}
            </h2>
            <StatusBadge tone={vehicle.tone} label={vehicle.statusLabel} size="md" />
          </div>
          <button
            type="button"
            onClick={onLocate}
            className="flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md transition-[filter] active:brightness-90"
          >
            <MapPin className="size-[17px]" />
            Locate on Map
          </button>
        </div>

        <div role="tablist" className="mt-5 flex gap-7 border-b border-border">
          {TABS.map((t) => {
            const active = tab === t
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab(t)}
                className={`-mb-px flex min-h-11 items-end border-b-[2.5px] pb-3.5 text-[15px] transition-colors ${
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground"
                }`}
              >
                {t}
              </button>
            )
          })}
        </div>

        {tab === "Overview" ? <Overview vehicle={vehicle} live={live} /> : null}
        {tab === "Vehicle" ? <VehicleTab vehicle={vehicle} /> : null}
        {tab === "Cargo" ? <CargoTab vehicle={vehicle} /> : null}
      </div>
    </div>
  )
}

function Overview({
  vehicle,
  live,
}: {
  vehicle: ConsoleVehicle
  live: LiveData
}) {
  const miniLive: LiveData = useMemo(() => {
    const raw = live.vehicles.find((v) => v.id === vehicle.id)
    const stops = live.stopsByVehicle.get(vehicle.id) ?? []
    const route = live.routes.get(vehicle.id)
    return {
      vehicles: raw ? [raw] : [],
      stopsByVehicle: raw ? new Map([[vehicle.id, stops]]) : new Map(),
      routes: route ? new Map([[vehicle.id, route]]) : new Map(),
      now: live.now,
    }
  }, [vehicle.id, live])

  return (
    <div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card label="Load Capacity">
          <div className="mt-2.5 flex items-end gap-3.5">
            <div className="font-heading text-5xl leading-[0.9] font-bold tracking-tight">
              {vehicle.capacityPct}%
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bubblebox-van.png"
              alt=""
              draggable={false}
              className="h-[62px] flex-1 object-contain"
            />
          </div>
          <p className="mt-4 text-[13px] text-muted-foreground">
            {vehicle.loadCount} pkg · {vehicle.loadWeight} of max load
          </p>
          <PlaceholderNote className="mt-2" />
        </Card>

        <Card label="Route Progress">
          <div className="mt-3 font-mono text-[34px] font-semibold tracking-tight">
            {vehicle.routeTimer}
          </div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {vehicle.routeLeftText}
          </p>
          <div className="mt-auto flex items-center gap-2.5 pt-4 text-[13.5px]">
            <span className="text-muted-foreground">{vehicle.origin}</span>
            <div className="relative h-0.5 flex-1 rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${vehicle.routeProgressPct}%` }}
              />
            </div>
            <span className="font-semibold">{vehicle.dest}</span>
          </div>
        </Card>
      </div>

      <h3 className="mt-6 font-heading text-base font-semibold">Live Location</h3>
      <div className="mt-3 h-[340px] overflow-hidden rounded-[20px] border border-border shadow-md">
        <FleetMapView
          vehicles={miniLive.vehicles}
          stopsByVehicle={miniLive.stopsByVehicle}
          routes={miniLive.routes}
          now={miniLive.now}
          showChrome={false}
        />
      </div>
    </div>
  )
}

function Card({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col rounded-[20px] border border-border bg-card p-5 shadow-md">
      <div className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

type DetailRow = {
  id: string
  icon: LucideIcon
  label: string
  sub: string
  value: string
  good?: boolean
}

function VehicleTab({ vehicle }: { vehicle: ConsoleVehicle }) {
  const rows: DetailRow[] = [
    { id: "model", icon: Truck, label: vehicle.model, sub: "Vehicle model", value: vehicle.plate },
    { id: "driver", icon: User, label: vehicle.driver, sub: "Assigned driver", value: "On shift", good: true },
    { id: "odo", icon: Gauge, label: "Odometer", sub: "Total distance", value: vehicle.odometer },
    { id: "fuel", icon: Fuel, label: "Fuel level", sub: "Current tank", value: `${vehicle.fuelPct}%`, good: true },
    { id: "temp", icon: Thermometer, label: "Cargo temperature", sub: "Cargo hold", value: vehicle.cargoTemp },
  ]
  return (
    <div className="mt-6 flex flex-col gap-3">
      <PlaceholderNote />
      {rows.map((r) => (
        <DetailRowItem key={r.id} row={r} />
      ))}
    </div>
  )
}

function CargoTab({ vehicle }: { vehicle: ConsoleVehicle }) {
  const photos = assumedCargoPhotos(vehicle.id)
  const manifest = assumedManifest(vehicle.id)
  const manifestIcons: Record<string, LucideIcon> = {
    pkg: Package,
    gross: Scale,
    temp: Thermometer,
  }
  return (
    <div className="mt-6">
      <PlaceholderNote />
      <h3 className="mt-4 font-heading text-base font-semibold">
        Cargo Photo Reports
      </h3>
      <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        {photos.map((p) => (
          <div
            key={p.id}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-md"
          >
            <div className="flex h-[104px] items-center justify-center bg-muted text-muted-foreground">
              <ImageIcon className="size-7" />
            </div>
            <div className="px-3.5 py-3">
              <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="size-1.5 rounded-full bg-primary" />
                {p.label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{p.meta}</div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="mt-7 font-heading text-base font-semibold">Manifest</h3>
      <div className="mt-3 flex flex-col gap-3">
        {manifest.map((m) => (
          <DetailRowItem
            key={m.id}
            row={{
              id: m.id,
              icon: manifestIcons[m.id] ?? Package,
              label: m.label,
              sub: m.sub,
              value: m.value,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function DetailRowItem({ row }: { row: DetailRow }) {
  const Icon = row.icon
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-md">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-[13px] bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{row.label}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">{row.sub}</div>
        </div>
      </div>
      <div
        className={`shrink-0 font-mono text-[15px] font-semibold ${
          row.good ? "text-success" : "text-foreground"
        }`}
      >
        {row.value}
      </div>
    </div>
  )
}

function PlaceholderNote({ className }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground/70 ${className ?? ""}`}>
      Placeholder data — pending a vehicle telematics feed.
    </p>
  )
}
