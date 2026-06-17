"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import type { Feature, FeatureCollection } from "geojson"
import { MaximizeIcon, MinimizeIcon } from "lucide-react"
import { Layer, Map as MapGL, Marker, Source } from "react-map-gl/maplibre"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { splitRoute, type RouteSplit } from "@/lib/route-slice"
import { useFleetRoutes, type RouteJob } from "@/lib/use-fleet-routes"
import { useLiveStops, type Stop } from "@/lib/use-live-stops"
import { useLiveVehicles, type Vehicle } from "@/lib/use-live-vehicles"
import { useNow } from "@/lib/use-now"
import type { Route, RouteGeometry } from "@/lib/route-types"

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`

// Drivers post ~every 5s; 30s of silence (6 missed) means stale/offline.
const STALE_AFTER_MS = 30_000

function isActive(s: Stop): boolean {
  return s.status === "planned" || s.status === "arrived"
}

function formatEta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 1) return "<1 min"
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function FleetMap({ displayCode }: { displayCode: string }) {
  const { vehicles, error, ready } = useLiveVehicles(displayCode)
  const { stopsByVehicle } = useLiveStops(ready)
  const now = useNow(5000)

  // One route job per vehicle with active stops; re-fetch keyed on the stop set.
  const jobs: RouteJob[] = useMemo(() => {
    const out: RouteJob[] = []
    for (const [vehicleId, stops] of stopsByVehicle) {
      const active = stops.filter(isActive)
      if (active.length === 0) continue
      out.push({
        vehicleId,
        stopsKey: active.map((s) => `${s.id}:${s.seq}:${s.status}`).join("|"),
      })
    }
    return out
  }, [stopsByVehicle])

  const routes = useFleetRoutes(jobs)

  // The lowest-seq active stop per vehicle (its "next stop").
  const nextStopIds = useMemo(() => {
    const ids = new Set<string>()
    for (const stops of stopsByVehicle.values()) {
      const next = stops.find(isActive) // hook returns each list sorted by seq
      if (next) ids.add(next.id)
    }
    return ids
  }, [stopsByVehicle])

  // Per-position traveled/remaining split, boundary held forward per vehicle.
  const progressRef = useRef(
    new Map<string, { split: RouteSplit; geometry: RouteGeometry }>()
  )
  const { remaining, traveled } = useMemo(() => {
    const prog = progressRef.current
    const remainingFeatures: Feature[] = []
    const traveledFeatures: Feature[] = []
    const seen = new Set<string>()
    for (const v of vehicles) {
      const route = routes.get(v.id)
      if (!route || v.last_lat == null || v.last_lng == null) continue
      seen.add(v.id)
      const prevEntry = prog.get(v.id)
      const prev =
        prevEntry && prevEntry.geometry === route.geometry
          ? prevEntry.split
          : null
      const split = splitRoute(route.geometry, [v.last_lng, v.last_lat], prev)
      prog.set(v.id, { split, geometry: route.geometry })
      remainingFeatures.push({
        type: "Feature",
        geometry: split.remaining,
        properties: { vehicle_id: v.id },
      })
      if (split.traveled) {
        traveledFeatures.push({
          type: "Feature",
          geometry: split.traveled,
          properties: { vehicle_id: v.id },
        })
      }
    }
    for (const id of [...prog.keys()]) if (!seen.has(id)) prog.delete(id)
    return {
      remaining: {
        type: "FeatureCollection",
        features: remainingFeatures,
      } as FeatureCollection,
      traveled: {
        type: "FeatureCollection",
        features: traveledFeatures,
      } as FeatureCollection,
    }
  }, [routes, vehicles])

  return (
    <div className="flex h-full w-full">
      <div className="relative h-full flex-1">
        {error ? (
          <Alert
            variant="destructive"
            className="absolute top-4 left-4 z-10 w-auto max-w-sm shadow-md"
          >
            <AlertDescription className="flex items-center gap-3">
              <span>{error}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearDisplayCode()
                  window.location.reload()
                }}
              >
                Change code
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <FullscreenButton />

        <MapGL
          initialViewState={{ longitude: 8.5417, latitude: 47.3769, zoom: 11 }}
          mapStyle={MAP_STYLE}
          style={{ width: "100%", height: "100%" }}
        >
          <Source id="routes-traveled" type="geojson" data={traveled}>
            <Layer
              id="routes-traveled-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#9ca3af",
                "line-width": 4,
                "line-opacity": 0.4,
              }}
            />
          </Source>

          <Source id="routes-remaining" type="geojson" data={remaining}>
            <Layer
              id="routes-remaining-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#2563eb",
                "line-width": 4,
                "line-opacity": 0.85,
              }}
            />
          </Source>

          {Array.from(stopsByVehicle.values())
            .flat()
            .map((s) => (
              <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="center">
                <StopMarker
                  stopType={s.stop_type}
                  status={s.status}
                  emphasized={nextStopIds.has(s.id)}
                />
              </Marker>
            ))}

          {vehicles.map((v) =>
            v.last_lat != null && v.last_lng != null ? (
              <InterpolatedMarker
                key={v.id}
                longitude={v.last_lng}
                latitude={v.last_lat}
                anchor="center"
              >
                <VehicleMarker
                  heading={v.last_heading ?? 0}
                  label={v.label}
                  stale={
                    v.last_seen_at == null ||
                    now - new Date(v.last_seen_at).getTime() > STALE_AFTER_MS
                  }
                />
              </InterpolatedMarker>
            ) : null
          )}
        </MapGL>
      </div>

      <FleetRail
        vehicles={vehicles}
        stopsByVehicle={stopsByVehicle}
        routes={routes}
        now={now}
      />
    </div>
  )
}

function FleetRail({
  vehicles,
  stopsByVehicle,
  routes,
  now,
}: {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
}) {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="border-b px-4 py-3 text-sm font-semibold">
        Fleet · {vehicles.length}
      </div>
      <ul className="flex-1 divide-y overflow-y-auto">
        {vehicles.map((v) => {
          const stops = stopsByVehicle.get(v.id) ?? []
          const active = stops.filter(isActive)
          const next = active[0] ?? null
          const eta = routes.get(v.id)?.legs[0]?.duration ?? null
          const stale =
            v.last_seen_at == null ||
            now - new Date(v.last_seen_at).getTime() > STALE_AFTER_MS
          const secondsAgo = v.last_seen_at
            ? Math.max(
                0,
                Math.round((now - new Date(v.last_seen_at).getTime()) / 1000)
              )
            : null
          return (
            <li key={v.id} className="px-4 py-3">
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
        })}
        {vehicles.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-muted-foreground">
            No vehicles
          </li>
        ) : null}
      </ul>
    </aside>
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

function FullscreenButton() {
  const [fs, setFs] = useState(false)
  useEffect(() => {
    const onChange = () => setFs(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  return (
    <Button
      variant="secondary"
      size="icon"
      className="absolute right-4 bottom-4 z-10 shadow-md"
      aria-label={fs ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen()
      }}
    >
      {fs ? (
        <MinimizeIcon className="size-4" />
      ) : (
        <MaximizeIcon className="size-4" />
      )}
    </Button>
  )
}

// Tween the displayed position from where it is now toward each new target
// over ~one update window, so markers glide instead of teleporting.
function useGlide(targetLng: number, targetLat: number, durationMs: number) {
  const [pos, setPos] = useState({ lng: targetLng, lat: targetLat })
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const from = { ...posRef.current }
    const to = { lng: targetLng, lat: targetLat }
    if (Math.abs(to.lng - from.lng) + Math.abs(to.lat - from.lat) < 1e-7) {
      setPos(to)
      return
    }
    let raf = 0
    let start: number | null = null
    const step = (ts: number) => {
      start ??= ts
      const t = Math.min(1, (ts - start) / durationMs)
      setPos({
        lng: from.lng + (to.lng - from.lng) * t,
        lat: from.lat + (to.lat - from.lat) * t,
      })
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [targetLng, targetLat, durationMs])

  return pos
}

function InterpolatedMarker({
  longitude,
  latitude,
  anchor,
  onClick,
  children,
}: {
  longitude: number
  latitude: number
  anchor?: ComponentProps<typeof Marker>["anchor"]
  onClick?: ComponentProps<typeof Marker>["onClick"]
  children: ReactNode
}) {
  const pos = useGlide(longitude, latitude, 5000)
  return (
    <Marker
      longitude={pos.lng}
      latitude={pos.lat}
      anchor={anchor}
      onClick={onClick}
    >
      {children}
    </Marker>
  )
}

function VehicleMarker({
  heading,
  label,
  stale,
}: {
  heading: number
  label: string | null
  stale: boolean
}) {
  const fill = stale ? "#9ca3af" : "#2563eb"
  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-0.5"
      style={{ opacity: stale ? 0.55 : 1 }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden
        style={{ transform: `rotate(${heading}deg)` }}
      >
        <path
          d="M12 2 L19 21 L12 17 L5 21 Z"
          fill={fill}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>
      {label ? (
        <span className="rounded bg-black/70 px-1 text-[10px] leading-tight text-white">
          {stale ? `${label} · stale` : label}
        </span>
      ) : null}
    </div>
  )
}

// pickup = green, dropoff = purple. Next stop emphasized (larger); terminal
// stops (completed/failed/skipped) faded.
function StopMarker({
  stopType,
  status,
  emphasized,
}: {
  stopType: "pickup" | "dropoff"
  status: string
  emphasized: boolean
}) {
  const terminal = status !== "planned" && status !== "arrived"
  const fill = stopType === "pickup" ? "#16a34a" : "#9333ea"
  const r = emphasized ? 9 : 6
  const size = (r + 3) * 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ opacity: terminal ? 0.35 : 1 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={fill}
        stroke="white"
        strokeWidth={emphasized ? 3 : 2}
      />
    </svg>
  )
}
