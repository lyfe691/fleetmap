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
      <div className="mx-auto max-w-[860px] px-8 pt-7 pb-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <h2 className="font-mono text-[28px] font-semibold tracking-tight">
              {vehicle.reg}
            </h2>
            <StatusBadge tone={vehicle.tone} label={vehicle.statusLabel} size="md" />
          </div>
          <button
            type="button"
            onClick={onLocate}
            className="flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-[16px] font-semibold text-primary-foreground shadow-md transition-[filter] active:brightness-90"
          >
            <MapPin className="size-5" />
            Locate on Map
          </button>
        </div>

        <div role="tablist" className="mt-6 flex gap-8 border-b border-border">
          {TABS.map((t) => {
            const active = tab === t
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTab(t)}
                className={`-mb-px flex min-h-14 items-end border-b-[3px] pb-4 text-[17px] transition-colors ${
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
      <div className="mt-7 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card label="Load Capacity">
          <div className="mt-3 flex items-center gap-3">
            <span className="font-heading text-[52px] leading-none font-bold tracking-tight">
              {vehicle.capacityPct}%
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bubblebox-van-tight.png"
              alt=""
              draggable={false}
              className="ml-auto h-[88px] w-auto object-contain"
            />
          </div>
          <p className="mt-4 text-[15px] text-muted-foreground">
            {vehicle.loadCount} pkg · {vehicle.loadWeight} of max load
          </p>
          <PlaceholderNote className="mt-2" />
        </Card>

        <Card label="Route Progress">
          <div className="mt-3 font-mono text-[40px] font-semibold tracking-tight">
            {vehicle.routeTimer}
          </div>
          <p className="mt-1 text-[15px] text-muted-foreground">
            {vehicle.routeLeftText}
          </p>
          <div className="mt-auto flex items-center gap-3 pt-5 text-[15px]">
            <span className="text-muted-foreground">{vehicle.origin}</span>
            <div className="relative h-1 flex-1 rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${vehicle.routeProgressPct}%` }}
              />
            </div>
            <span className="font-semibold">{vehicle.dest}</span>
          </div>
        </Card>
      </div>

      <h3 className="mt-7 font-heading text-lg font-semibold">Live Location</h3>
      <div className="mt-3 h-[400px] overflow-hidden rounded-[20px] border border-border shadow-md">
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
    <div className="flex flex-col rounded-[20px] border border-border bg-card p-6 shadow-md">
      <div className="text-[14px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
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
    <div className="mt-7 flex flex-col gap-3">
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
    <div className="mt-7">
      <PlaceholderNote />
      <h3 className="mt-4 font-heading text-lg font-semibold">
        Cargo Photo Reports
      </h3>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {photos.map((p) => (
          <div
            key={p.id}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-md"
          >
            <div className="flex h-[128px] items-center justify-center bg-muted text-muted-foreground">
              <ImageIcon className="size-9" />
            </div>
            <div className="px-4 py-3.5">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <span className="size-2 rounded-full bg-primary" />
                {p.label}
              </div>
              <div className="mt-1 text-[13px] text-muted-foreground">{p.meta}</div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="mt-8 font-heading text-lg font-semibold">Manifest</h3>
      <div className="mt-4 flex flex-col gap-3">
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
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-6 py-5 shadow-md">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold">{row.label}</div>
          <div className="mt-0.5 text-[14px] text-muted-foreground">{row.sub}</div>
        </div>
      </div>
      <div
        className={`shrink-0 font-mono text-[17px] font-semibold ${
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
    <p className={`text-[13px] text-muted-foreground/70 ${className ?? ""}`}>
      Placeholder data — pending a vehicle telematics feed.
    </p>
  )
}
