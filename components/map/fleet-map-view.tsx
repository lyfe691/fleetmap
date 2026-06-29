"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { MaximizeIcon, MinimizeIcon, MinusIcon, PlusIcon } from "lucide-react"
import { useTheme } from "next-themes"
import {
  Layer,
  Map as MapGL,
  Marker,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import { mapColors, mapStyleUrl, type MapTheme } from "@/lib/map-theme"
import { useTranslations } from "@/lib/i18n"
import { useRouteFeatures } from "@/lib/use-route-features"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import { isActive } from "@/components/map/fleet-format"
import {
  InterpolatedMarker,
  VehicleMarker,
  StopMarker,
  isStale,
} from "@/components/map/vehicle-marker"

function computeFleetBounds(
  vehicles: Vehicle[]
): [[number, number], [number, number]] | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const v of vehicles) {
    if (v.last_lng == null || v.last_lat == null) continue
    w = Math.min(w, v.last_lng)
    e = Math.max(e, v.last_lng)
    s = Math.min(s, v.last_lat)
    n = Math.max(n, v.last_lat)
  }
  return w === Infinity ? null : [[w, s], [e, n]]
}

export function FleetMapView({
  vehicles,
  stopsByVehicle,
  routes,
  now,
  selectedId,
  onSelectVehicle,
  showChrome = true,
}: {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
  selectedId?: string | null
  onSelectVehicle?: (id: string) => void
  showChrome?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const theme: MapTheme = resolvedTheme === "dark" ? "dark" : "light"
  const colors = useMemo(() => mapColors(theme), [theme])
  const styleUrl = useMemo(() => mapStyleUrl(theme), [theme])

  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  // One camera policy: ease to the selected vehicle, or fit the whole shown set
  // when nothing is selected — that single rule covers the Live Map's
  // focus-on-select, its "view all" (cleared selection), and the framing for
  // the single-vehicle mini-map. Keyed so position updates don't re-frame.
  const cameraKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current
    if (!map) return

    const idsKey = vehicles
      .map((v) => v.id)
      .sort()
      .join(",")
    const key = selectedId ? `focus:${selectedId}` : `fleet:${idsKey}`
    if (key === cameraKeyRef.current) return
    const first = cameraKeyRef.current === null
    cameraKeyRef.current = key

    if (selectedId) {
      const v = vehicles.find((x) => x.id === selectedId)
      if (!v || v.last_lng == null || v.last_lat == null) {
        cameraKeyRef.current = null
        return
      }
      map.easeTo({
        center: [v.last_lng, v.last_lat],
        zoom: Math.max(map.getZoom(), 13),
        duration: first ? 0 : 700,
      })
      return
    }

    const bounds = computeFleetBounds(vehicles)
    if (!bounds) {
      cameraKeyRef.current = null
      return
    }
    map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: first ? 0 : 600 })
  }, [mapLoaded, selectedId, vehicles])

  const { nextStopIds, onRouteIds } = useMemo(() => {
    const next = new Set<string>()
    const onRoute = new Set<string>()
    for (const [vid, stops] of stopsByVehicle) {
      const first = stops.find(isActive)
      if (first) {
        next.add(first.id)
        onRoute.add(vid)
      }
    }
    return { nextStopIds: next, onRouteIds: onRoute }
  }, [stopsByVehicle])

  const stopMarkers = useMemo(
    () =>
      Array.from(stopsByVehicle.values())
        .flat()
        .map((s) => (
          <Marker key={s.id} longitude={s.lng} latitude={s.lat} anchor="center">
            <StopMarker
              fill={s.stop_type === "pickup" ? colors.pickup : colors.dropoff}
              stroke={colors.markerStroke}
              emphasized={nextStopIds.has(s.id)}
              terminal={s.status !== "planned" && s.status !== "arrived"}
            />
          </Marker>
        )),
    [stopsByVehicle, nextStopIds, colors]
  )

  const { remaining, traveled } = useRouteFeatures(routes, vehicles)

  return (
    <>
      {showChrome ? (
        <>
          <FullscreenButton />
          <ZoomControls
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
          />
          <MapLegend />
        </>
      ) : null}

      <MapGL
        ref={mapRef}
        reuseMaps
        onLoad={() => setMapLoaded(true)}
        initialViewState={{ longitude: 8.23, latitude: 46.8, zoom: 7.2 }}
        mapStyle={styleUrl}
        style={{ width: "100%", height: "100%" }}
      >
        <Source id="routes-traveled" type="geojson" data={traveled}>
          <Layer
            id="routes-traveled-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": colors.traveled, "line-width": 4, "line-opacity": 0.45 }}
          />
        </Source>

        <Source id="routes-remaining" type="geojson" data={remaining}>
          <Layer
            id="routes-remaining-casing"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": colors.routeCasing, "line-width": 8, "line-opacity": 0.9 }}
          />
          <Layer
            id="routes-remaining-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": colors.route, "line-width": 4.5, "line-opacity": 0.95 }}
          />
        </Source>

        {stopMarkers}

        {vehicles.map((v) => {
          if (v.last_lat == null || v.last_lng == null) return null
          const stale = isStale(v.last_seen_at, now)
          const fill = stale
            ? colors.vehicleStale
            : onRouteIds.has(v.id)
              ? colors.vehicleOnRoute
              : colors.vehicleWaiting
          return (
            <InterpolatedMarker
              key={v.id}
              longitude={v.last_lng}
              latitude={v.last_lat}
              anchor="center"
              onClick={() => onSelectVehicle?.(v.id)}
            >
              <VehicleMarker
                label={v.label}
                stale={stale}
                selected={v.id === selectedId}
                fill={fill}
              />
            </InterpolatedMarker>
          )
        })}
      </MapGL>
    </>
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
    <button
      type="button"
      aria-label={fs ? "Exit fullscreen" : "Enter fullscreen"}
      onClick={() => {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen()
      }}
      className="absolute top-5 right-5 z-10 flex size-14 items-center justify-center rounded-2xl border border-border bg-surface text-foreground shadow-md transition-[filter] active:brightness-95"
    >
      {fs ? <MinimizeIcon className="size-6" /> : <MaximizeIcon className="size-6" />}
    </button>
  )
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
}) {
  const t = useTranslations()
  return (
    <div className="absolute right-5 bottom-5 z-10 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-md">
      <button
        type="button"
        aria-label={t("map.zoomIn")}
        onClick={onZoomIn}
        className="flex size-14 items-center justify-center border-b border-border text-foreground transition-colors hover:bg-muted active:bg-muted"
      >
        <PlusIcon className="size-6" />
      </button>
      <button
        type="button"
        aria-label={t("map.zoomOut")}
        onClick={onZoomOut}
        className="flex size-14 items-center justify-center text-foreground transition-colors hover:bg-muted active:bg-muted"
      >
        <MinusIcon className="size-6" />
      </button>
    </div>
  )
}

function MapLegend() {
  return (
    <div className="absolute bottom-5 left-5 z-10 flex gap-5 rounded-2xl border border-border bg-surface/85 px-5 py-3.5 text-[14px] font-medium shadow-md backdrop-blur">
      <LegendDot className="bg-success" label="On Route" />
      <LegendDot className="bg-warning" label="Waiting" />
      <LegendDot className="bg-muted-foreground" label="Stale" />
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`size-3 rounded-full ${className}`} />
      {label}
    </span>
  )
}
