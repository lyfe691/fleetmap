"use client"

import { useMemo } from "react"
import { isActive, formatEta } from "@/components/map/fleet-format"
import { STALE_AFTER_MS } from "@/components/map/vehicle-marker"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import type { OperationalArea } from "@/lib/use-operational-areas"

export function FleetRail({
  vehicles,
  stopsByVehicle,
  routes,
  areas,
  now,
}: {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  areas: OperationalArea[]
  now: number
}) {
  const areaById = useMemo(
    () => new Map(areas.map((a) => [a.id, a] as const)),
    [areas]
  )

  const UNASSIGNED = "—"
  const grouped = useMemo(() => {
    const g = new Map<string, Vehicle[]>()
    for (const v of vehicles) {
      const key = v.area_id ?? UNASSIGNED
      const list = g.get(key)
      if (list) list.push(v)
      else g.set(key, [v])
    }
    return g
  }, [vehicles])
  const order = useMemo(() => {
    const keys = areas.map((a) => a.id).filter((id) => grouped.has(id))
    if (grouped.has(UNASSIGNED)) keys.push(UNASSIGNED)
    return keys
  }, [areas, grouped])

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="border-b px-4 py-3 text-sm font-semibold">
        Fleet · {vehicles.length}
      </div>
      <div className="flex-1 overflow-y-auto">
        {order.map((key) => {
          const area = areaById.get(key)
          const list = grouped.get(key) ?? []
          return (
            <section key={key}>
              <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                {area ? (
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: area.color }}
                  />
                ) : null}
                <span>{area?.name ?? "Unassigned"}</span>
                <span className="ml-auto">{list.length}</span>
              </div>
              <ul className="divide-y">
                {list.map((v) => (
                  <FleetRailRow
                    key={v.id}
                    v={v}
                    stops={stopsByVehicle.get(v.id) ?? []}
                    eta={routes.get(v.id)?.legs[0]?.duration ?? null}
                    now={now}
                  />
                ))}
              </ul>
            </section>
          )
        })}
        {vehicles.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No vehicles
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function FleetRailRow({
  v,
  stops,
  eta,
  now,
}: {
  v: Vehicle
  stops: Stop[]
  eta: number | null
  now: number
}) {
  const active = stops.filter(isActive)
  const next = active[0] ?? null
  const stale =
    v.last_seen_at == null ||
    now - new Date(v.last_seen_at).getTime() > STALE_AFTER_MS
  const secondsAgo = v.last_seen_at
    ? Math.max(0, Math.round((now - new Date(v.last_seen_at).getTime()) / 1000))
    : null
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2">
        <StatusDot active={active.length > 0} stale={stale} />
        <span className="truncate text-sm font-medium">
          {v.label ?? "Vehicle"}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {secondsAgo == null ? "—" : `${secondsAgo}s ago`}
        </span>
      </div>
      <div className="mt-1 pl-4 text-xs text-muted-foreground">
        {next ? (
          <>
            Next: {next.stop_type === "pickup" ? "Pickup" : "Dropoff"}
            {eta != null ? (
              <>
                {" · "}
                <span className="text-foreground">{formatEta(eta)}</span>
              </>
            ) : null}
            {" · "}
            {active.length} stop{active.length === 1 ? "" : "s"} left
          </>
        ) : (
          "Idle"
        )}
      </div>
    </li>
  )
}

function StatusDot({ active, stale }: { active: boolean; stale: boolean }) {
  const color = stale ? "#9ca3af" : active ? "#2563eb" : "#cbd5e1"
  return (
    <span
      className="size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  )
}
