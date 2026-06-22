"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { MaximizeIcon, MinimizeIcon } from "lucide-react"
import {
  Layer,
  Map as MapGL,
  Marker,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import { Button } from "@/components/ui/button"
import { useRouteFeatures } from "@/lib/use-route-features"
import { areasToFeatureCollection, type OperationalArea } from "@/lib/use-operational-areas"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import { isActive } from "@/components/map/fleet-format"
import {
  InterpolatedMarker,
  VehicleMarker,
  StopMarker,
  STALE_AFTER_MS,
} from "@/components/map/vehicle-marker"

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`

function computeFleetBounds(
  areas: OperationalArea[],
  vehicles: Vehicle[]
): [[number, number], [number, number]] | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const add = (lng: number, lat: number) => {
    w = Math.min(w, lng)
    e = Math.max(e, lng)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  for (const a of areas) {
    const dLat = a.radius_m / 111_320
    const dLng = a.radius_m / (111_320 * Math.cos((a.center_lat * Math.PI) / 180))
    add(a.center_lng - dLng, a.center_lat - dLat)
    add(a.center_lng + dLng, a.center_lat + dLat)
  }
  for (const v of vehicles) {
    if (v.last_lng != null && v.last_lat != null) add(v.last_lng, v.last_lat)
  }
  return w === Infinity ? null : [[w, s], [e, n]]
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

function MapLegend({ areas }: { areas: OperationalArea[] }) {
  if (areas.length === 0) return null
  return (
    <div className="absolute bottom-4 left-4 z-10 rounded-md border bg-background/80 px-3 py-2 text-xs shadow-sm backdrop-blur">
      <div className="mb-1.5 font-medium text-muted-foreground">
        Operational areas
      </div>
      <ul className="space-y-1">
        {areas.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: a.color }}
            />
            <span>{a.name}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-muted-foreground">
        <LegendDot color="#16a34a" label="Pickup" />
        <LegendDot color="#9333ea" label="Dropoff" />
        <LegendDot color="#2563eb" label="Live" />
        <LegendDot color="#9ca3af" label="Stale" />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

export function FleetMapView({
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
  const areaFc = useMemo(() => areasToFeatureCollection(areas), [areas])

  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || !mapLoaded) return
    const bounds = computeFleetBounds(areas, vehicles)
    if (!bounds) return
    fittedRef.current = true
    mapRef.current?.fitBounds(bounds, { padding: 64, duration: 0 })
  }, [mapLoaded, areas, vehicles])

  const nextStopIds = useMemo(() => {
    const ids = new Set<string>()
    for (const stops of stopsByVehicle.values()) {
      const next = stops.find(isActive)
      if (next) ids.add(next.id)
    }
    return ids
  }, [stopsByVehicle])

  const stopMarkers = useMemo(
    () =>
      Array.from(stopsByVehicle.values())
        .flat()
        .map((s) => (
          <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="center">
            <StopMarker
              stopType={s.stop_type}
              status={s.status}
              emphasized={nextStopIds.has(s.id)}
            />
          </Marker>
        )),
    [stopsByVehicle, nextStopIds]
  )

  const { remaining, traveled } = useRouteFeatures(routes, vehicles)

  return (
    <>
      <FullscreenButton />
      <MapLegend areas={areas} />

      <MapGL
        ref={mapRef}
        onLoad={() => setMapLoaded(true)}
        initialViewState={{ longitude: 8.23, latitude: 46.8, zoom: 7.2 }}
        mapStyle={MAP_STYLE}
        style={{ width: "100%", height: "100%" }}
      >
        <Source id="operational-areas" type="geojson" data={areaFc}>
          <Layer
            id="operational-areas-fill"
            type="fill"
            paint={{
              "fill-color": ["get", "color"],
              "fill-opacity": 0.07,
            }}
          />
          <Layer
            id="operational-areas-outline"
            type="line"
            layout={{ "line-join": "round" }}
            paint={{
              "line-color": ["get", "color"],
              "line-width": 1.5,
              "line-opacity": 0.4,
              "line-dasharray": [3, 2],
            }}
          />
        </Source>

        {areas.map((a) => (
          <Marker
            key={a.id}
            longitude={a.center_lng}
            latitude={a.center_lat}
            anchor="center"
          >
            <span
              className="pointer-events-none select-none text-[11px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: a.color, textShadow: "0 0 3px #fff, 0 0 3px #fff" }}
            >
              {a.name}
            </span>
          </Marker>
        ))}

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

        {stopMarkers}

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
    </>
  )
}
