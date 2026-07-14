"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MaximizeIcon, MinimizeIcon, MinusIcon, PlusIcon } from "lucide-react"
import { useTheme } from "next-themes"
import {
  Layer,
  Map as MapGL,
  Marker,
  Source,
  type MapRef,
} from "react-map-gl/maplibre"
import type { DataDrivenPropertyValueSpecification } from "maplibre-gl"
import { mapColors, mapStyleUrl, type MapTheme } from "@/lib/map-theme"
import { useLocale, useTranslations } from "@/lib/i18n"
import { formatClock } from "@/lib/i18n/format"
import { useRouteFeatures } from "@/lib/use-route-features"
import { assessLateness, snapFraction, type Lateness } from "@/lib/schedule"
import type { Vehicle } from "@/lib/use-live-vehicles"
import type { Stop } from "@/lib/use-live-stops"
import type { Route } from "@/lib/route-types"
import { isActive } from "@/components/map/fleet-format"
import {
  InterpolatedMarker,
  VehicleMarker,
  StopBadge,
  StopDot,
  isStale,
  type StopState,
} from "@/components/map/vehicle-marker"

// Explicit stacking tiers — react-map-gl markers are DOM siblings added at
// mount, so JSX order can't restack them on selection; the style prop can.
const Z = { dimmedDot: 1, dot: 2, badge: 3, next: 4, vehicle: 5 } as const

// Avoid stacking styleimagemissing handlers when reuseMaps re-attaches.
const mapsWithImageStub = new WeakSet<object>()

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
  follow = false,
}: {
  vehicles: Vehicle[]
  stopsByVehicle: Map<string, Stop[]>
  routes: Map<string, Route>
  now: number
  selectedId?: string | null
  onSelectVehicle?: (id: string) => void
  showChrome?: boolean
  follow?: boolean
}) {
  const { resolvedTheme } = useTheme()
  const theme: MapTheme = resolvedTheme === "dark" ? "dark" : "light"
  const colors = useMemo(() => mapColors(theme), [theme])
  const styleUrl = useMemo(() => mapStyleUrl(theme), [theme])

  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  // Ref CALLBACK, not a mount effect: react-map-gl attaches the map instance in
  // its own (parent) effect, after this component's effects have already run.
  // And with `reuseMaps` a view switch hands back an ALREADY loaded instance
  // whose `load` event never re-fires — so onLoad alone would leave mapLoaded
  // false and every camera effect dead. The callback fires exactly at attach:
  // an already-styled (reused) map arms immediately; a fresh one goes through
  // onLoad, with `idle` as the fallback for a reused map mid-style-load.
  const attachMap = useCallback((instance: MapRef | null) => {
    mapRef.current = instance
    if (!instance) return
    const map = instance.getMap()
    // Some basemap styles reference a blank icon id (" ").
    // MapLibre then spam-logs "Image \" \" could not be loaded" — unrelated to
    // our markers (those are DOM). Stub a transparent pixel for empty ids only.
    if (!mapsWithImageStub.has(map)) {
      mapsWithImageStub.add(map)
      map.on("styleimagemissing", (e) => {
        if (e.id.trim() !== "") return
        if (map.hasImage(e.id)) return
        map.addImage(e.id, {
          width: 1,
          height: 1,
          data: new Uint8Array([0, 0, 0, 0]),
        })
      })
    }
    if (map.isStyleLoaded()) setMapLoaded(true)
    else map.once("idle", () => setMapLoaded(true))
  }, [])
  // One camera policy: frame the selected vehicle's FULL day (route bounds —
  // with 20 stops the day must be visible, not just the van point), or fit the
  // whole shown set when nothing is selected. Keyed so position updates don't
  // re-frame; a selected van re-frames when its route changes (stop set edit).
  const cameraKeyRef = useRef<string | null>(null)
  const framedRouteRef = useRef<Route | null>(null)
  useEffect(() => {
    if (!mapLoaded) return
    if (follow) {
      // Follow owns the camera. Poison the key (unless the map was never
      // framed at all) so this policy re-frames when follow disengages —
      // e.g. "view all" after following a van.
      if (cameraKeyRef.current !== null) cameraKeyRef.current = "follow"
      return
    }
    const map = mapRef.current
    if (!map) return

    const idsKey = vehicles
      .map((v) => v.id)
      .sort()
      .join(",")
    const key = selectedId ? `focus:${selectedId}` : `fleet:${idsKey}`
    const focusRoute = selectedId ? (routes.get(selectedId) ?? null) : null
    if (key === cameraKeyRef.current && focusRoute === framedRouteRef.current)
      return
    const first = cameraKeyRef.current === null
    cameraKeyRef.current = key
    framedRouteRef.current = focusRoute

    if (selectedId) {
      const v = vehicles.find((x) => x.id === selectedId)
      if (!v || v.last_lng == null || v.last_lat == null) {
        cameraKeyRef.current = null
        return
      }
      if (focusRoute) {
        let w = v.last_lng
        let e = v.last_lng
        let s = v.last_lat
        let n = v.last_lat
        for (const [lng, lat] of focusRoute.geometry.coordinates) {
          w = Math.min(w, lng)
          e = Math.max(e, lng)
          s = Math.min(s, lat)
          n = Math.max(n, lat)
        }
        map.fitBounds([[w, s], [e, n]], {
          padding: 80,
          maxZoom: 15,
          duration: first ? 0 : 700,
        })
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
  }, [mapLoaded, follow, selectedId, vehicles, routes])

  // Follow mode (mini-map always; Live Map while a vehicle is selected) owns
  // the camera instead of the policy above: engaging or switching vehicles
  // re-frames like focus-on-select (quick ease + zoom), then position updates
  // of the SAME vehicle glide the center in a slow linear ease that roughly
  // matches the marker interpolation. A manual pan hands control to the user
  // until the followed vehicle changes or follow is re-engaged.
  const followTarget = follow
    ? (vehicles.find((v) => v.id === (selectedId ?? vehicles[0]?.id)) ?? null)
    : null
  const userPannedRef = useRef(false)
  const followedIdRef = useRef<string | null>(null)
  const reframeUntilRef = useRef(0)
  useEffect(() => {
    if (!mapLoaded) return
    if (!followTarget || followTarget.last_lng == null || followTarget.last_lat == null) {
      // Not following (or the van has no fix): forget the target so the next
      // engagement re-frames — even if it's the same vehicle again.
      followedIdRef.current = null
      return
    }
    const map = mapRef.current
    if (!map) return

    const center: [number, number] = [followTarget.last_lng, followTarget.last_lat]
    if (followedIdRef.current !== followTarget.id) {
      // Instant only when the map has never been framed (mini-map mount);
      // engaging follow on an already-framed map animates like a focus.
      const first = followedIdRef.current === null && cameraKeyRef.current === null
      followedIdRef.current = followTarget.id
      userPannedRef.current = false
      reframeUntilRef.current = performance.now() + (first ? 0 : 750)
      map.easeTo({ center, zoom: Math.max(map.getZoom(), 14), duration: first ? 0 : 700 })
      return
    }
    // Let the switch re-frame land before gliding — a glide arriving mid-ease
    // would cancel it and drop its zoom target.
    if (userPannedRef.current || performance.now() < reframeUntilRef.current) return
    map.easeTo({ center, duration: 4000, easing: (x) => x })
  }, [mapLoaded, followTarget?.id, followTarget?.last_lng, followTarget?.last_lat])

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

  // Per-van schedule adherence: projected arrival at the next active stop vs
  // its eta_at (+ grace). Late vans get a red remaining line + a red next
  // badge/ETA pill; each van colours independently.
  const latenessById = useMemo(() => {
    const map = new Map<string, Lateness>()
    for (const v of vehicles) {
      const stops = stopsByVehicle.get(v.id)
      if (!stops?.length) continue
      const route = routes.get(v.id)
      const fraction =
        route && v.last_lng != null && v.last_lat != null
          ? snapFraction(route.geometry, [v.last_lng, v.last_lat])
          : null
      map.set(v.id, assessLateness({ route, stops, fraction, now }))
    }
    return map
  }, [vehicles, stopsByVehicle, routes, now])
  const lateIds = useMemo(
    () =>
      new Set(
        [...latenessById].filter(([, l]) => l.late).map(([id]) => id)
      ),
    [latenessById]
  )

  const locale = useLocale()
  // Two-tier stop language. Fleet view: every stop is a small on-line dot
  // (ring = the van's line colour; done = traveled grey), the next stop a
  // touch larger. Focus mode (a van selected): that van's stops upgrade to
  // seq-numbered badges (done/next/upcoming), its next stop carries the
  // projected-ETA pill, and every other van's dots dim with its line.
  const stopMarkers = useMemo(() => {
    const markers: React.ReactNode[] = []
    for (const [vid, stops] of stopsByVehicle) {
      const focused = vid === selectedId
      const lateness = latenessById.get(vid)
      const late = lateness?.late ?? false
      stops.forEach((s, i) => {
        const done = s.status !== "planned" && s.status !== "arrived"
        const isNext = nextStopIds.has(s.id)
        if (focused) {
          const state: StopState = done ? "done" : isNext ? "next" : "upcoming"
          // Pill hidden while the van sits at the stop (status "arrived"):
          // its own label pill occupies the same pixels, and the projection
          // is ~now anyway.
          const etaLabel =
            isNext && s.status !== "arrived" && lateness?.projectedArrivalMs != null
              ? formatClock(lateness.projectedArrivalMs, locale)
              : null
          markers.push(
            <Marker
              key={s.id}
              longitude={s.lng}
              latitude={s.lat}
              anchor="center"
              style={{ zIndex: state === "next" ? Z.next : Z.badge }}
            >
              <StopBadge
                number={i + 1}
                state={state}
                fill={
                  state === "done"
                    ? colors.stopDoneFill
                    : state === "next"
                      ? late
                        ? colors.routeLate
                        : colors.stopNextFill
                      : colors.markerStroke
                }
                text={
                  state === "done"
                    ? colors.stopDoneText
                    : state === "next"
                      ? colors.stopNextText
                      : colors.stopUpcomingText
                }
                border={
                  state === "next"
                    ? colors.markerStroke
                    : state === "upcoming"
                      ? colors.route
                      : undefined
                }
                etaLabel={etaLabel}
                etaLate={late}
              />
            </Marker>
          )
        } else {
          markers.push(
            <Marker
              key={s.id}
              longitude={s.lng}
              latitude={s.lat}
              anchor="center"
              style={{ zIndex: selectedId ? Z.dimmedDot : Z.dot }}
            >
              <StopDot
                fill={colors.markerStroke}
                ring={
                  done ? colors.traveled : late ? colors.routeLate : colors.route
                }
                emphasized={isNext}
                dimmed={selectedId != null}
              />
            </Marker>
          )
        }
      })
    }
    return markers
  }, [stopsByVehicle, nextStopIds, latenessById, selectedId, colors, locale])

  const { remaining, traveled } = useRouteFeatures(
    routes,
    vehicles,
    stopsByVehicle,
    lateIds
  )

  // Focus mode dims the other vans' lines to ~15%. Built conditionally —
  // MapLibre expressions can't compare against a JS null. The traveled
  // features only carry vehicle_id (no `late`), so only opacity is
  // data-driven there.
  const dimmable = (
    full: number
  ): DataDrivenPropertyValueSpecification<number> =>
    selectedId != null
      ? ["case", ["==", ["get", "vehicle_id"], selectedId], full, full * 0.15]
      : full

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
        ref={attachMap}
        reuseMaps
        onLoad={() => setMapLoaded(true)}
        onDragStart={() => {
          userPannedRef.current = true
        }}
        initialViewState={{ longitude: 8.23, latitude: 46.8, zoom: 7.2 }}
        mapStyle={styleUrl}
        style={{ width: "100%", height: "100%" }}
      >
        <Source id="routes-traveled" type="geojson" data={traveled}>
          <Layer
            id="routes-traveled-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": colors.traveled,
              "line-width": 4,
              "line-opacity": dimmable(0.45),
            }}
          />
        </Source>

        <Source id="routes-remaining" type="geojson" data={remaining}>
          <Layer
            id="routes-remaining-casing"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              "line-color": colors.routeCasing,
              "line-width": 8,
              "line-opacity": dimmable(0.9),
            }}
          />
          <Layer
            id="routes-remaining-line"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{
              // Data-driven: a late van's remaining line goes red; the done
              // (grey) portion is untouched.
              "line-color": [
                "case",
                ["boolean", ["get", "late"], false],
                colors.routeLate,
                colors.route,
              ],
              "line-width": 4.5,
              "line-opacity": dimmable(0.95),
            }}
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
              style={{ zIndex: Z.vehicle }}
            >
              <VehicleMarker
                label={v.label}
                stale={stale}
                // The selected treatment (size + ping) distinguishes one van
                // among many; the chrome-less mini-map shows exactly one, so
                // the pulse would be pure noise there.
                selected={v.id === selectedId && showChrome}
                fill={fill}
                heading={v.last_heading}
              />
            </InterpolatedMarker>
          )
        })}
      </MapGL>
    </>
  )
}

function FullscreenButton() {
  const t = useTranslations()
  const [fs, setFs] = useState(false)
  useEffect(() => {
    const onChange = () => setFs(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])
  return (
    <button
      type="button"
      aria-label={fs ? t("map.exitFullscreen") : t("map.enterFullscreen")}
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
  const t = useTranslations()
  return (
    <div className="absolute bottom-5 left-5 z-10 flex gap-5 rounded-2xl border border-border bg-surface/85 px-5 py-3.5 text-[0.9375rem] font-medium shadow-md backdrop-blur">
      <LegendDot className="bg-success" label={t("status.onRoute")} />
      <LegendDot className="bg-warning" label={t("status.waiting")} />
      <LegendDot className="bg-destructive" label={t("status.late")} />
      <LegendDot className="bg-muted-foreground" label={t("status.stale")} />
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`size-3.5 rounded-full ${className}`} />
      {label}
    </span>
  )
}
