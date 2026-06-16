"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useMemo, useState } from "react"
import { Layer, Map, Marker, Source } from "react-map-gl/maplibre"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { useLiveVehicles } from "@/lib/use-live-vehicles"
import { useRoute } from "@/lib/use-route"

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`

function formatEta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 1) return "<1 min"
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1)} km`
}

export function FleetMap({ displayCode }: { displayCode: string }) {
  const { vehicles, error } = useLiveVehicles(displayCode)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dest, setDest] = useState<{ lat: number; lng: number } | null>(null)

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? null,
    [vehicles, selectedId]
  )

  // Re-fetch the route whenever the selected truck moves.
  const positionKey =
    selected && selected.last_lat != null && selected.last_lng != null
      ? `${selected.last_lng},${selected.last_lat}`
      : null

  const { route, error: routeError, loading } = useRoute(
    selectedId,
    dest,
    positionKey
  )

  const clearRoute = () => {
    setSelectedId(null)
    setDest(null)
  }

  return (
    <div className="relative h-full w-full">
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

      {selectedId ? (
        <RoutePanel
          label={selected?.label ?? null}
          hasDest={dest !== null}
          loading={loading}
          error={routeError}
          duration={route?.duration ?? null}
          distance={route?.distance ?? null}
          onClear={clearRoute}
        />
      ) : null}

      <Map
        initialViewState={{ longitude: 8.5417, latitude: 47.3769, zoom: 11 }}
        mapStyle={MAP_STYLE}
        style={{ width: "100%", height: "100%" }}
        cursor={selectedId && !dest ? "crosshair" : undefined}
        onClick={(e) => {
          // With a vehicle selected, a map click sets its destination.
          if (selectedId) setDest({ lat: e.lngLat.lat, lng: e.lngLat.lng })
        }}
      >
        {route ? (
          <Source
            id="route"
            type="geojson"
            data={{ type: "Feature", geometry: route.geometry, properties: {} }}
          >
            <Layer
              id="route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "#2563eb",
                "line-width": 4,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        ) : null}

        {dest ? (
          <Marker longitude={dest.lng} latitude={dest.lat} anchor="bottom">
            <DestPin />
          </Marker>
        ) : null}

        {vehicles.map((v) =>
          v.last_lat != null && v.last_lng != null ? (
            <Marker
              key={v.id}
              longitude={v.last_lng}
              latitude={v.last_lat}
              anchor="center"
              onClick={(e) => {
                e.originalEvent.stopPropagation()
                setSelectedId(v.id)
                setDest(null)
              }}
            >
              <VehicleMarker
                heading={v.last_heading ?? 0}
                label={v.label}
                selected={v.id === selectedId}
              />
            </Marker>
          ) : null
        )}
      </Map>
    </div>
  )
}

function RoutePanel({
  label,
  hasDest,
  loading,
  error,
  duration,
  distance,
  onClear,
}: {
  label: string | null
  hasDest: boolean
  loading: boolean
  error: string | null
  duration: number | null
  distance: number | null
  onClear: () => void
}) {
  return (
    <div className="absolute top-4 right-4 z-10 w-56 rounded-lg border bg-background/95 p-4 shadow-md backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{label ?? "Vehicle"}</span>
        <Button variant="ghost" size="sm" className="-mt-1 -mr-2" onClick={onClear}>
          Clear
        </Button>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {!hasDest ? (
          "Click the map to set a destination."
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : loading && duration == null ? (
          "Routing…"
        ) : duration != null && distance != null ? (
          <span className="text-foreground">
            <span className="text-lg font-semibold">{formatEta(duration)}</span>
            <span className="text-muted-foreground"> · {formatDistance(distance)}</span>
          </span>
        ) : (
          "Routing…"
        )}
      </div>
    </div>
  )
}

function VehicleMarker({
  heading,
  label,
  selected,
}: {
  heading: number
  label: string | null
  selected: boolean
}) {
  return (
    <div className="flex cursor-pointer flex-col items-center gap-0.5">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden
        style={{ transform: `rotate(${heading}deg)` }}
      >
        <path
          d="M12 2 L19 21 L12 17 L5 21 Z"
          fill={selected ? "#dc2626" : "#2563eb"}
          stroke="white"
          strokeWidth="1.5"
        />
      </svg>
      {label ? (
        <span className="rounded bg-black/70 px-1 text-[10px] leading-tight text-white">
          {label}
        </span>
      ) : null}
    </div>
  )
}

function DestPin() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2 C8 2 5 5 5 9 c0 5 7 13 7 13 s7-8 7-13 c0-4-3-7-7-7 Z"
        fill="#dc2626"
        stroke="white"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="9" r="2.5" fill="white" />
    </svg>
  )
}
