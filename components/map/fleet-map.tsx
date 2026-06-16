"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { Map, Marker } from "react-map-gl/maplibre"
import { clearDisplayCode } from "@/lib/dashboard-code"
import { useLiveVehicles } from "@/lib/use-live-vehicles"

const MAP_STYLE = `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`

export function FleetMap({ displayCode }: { displayCode: string }) {
  const { vehicles, error } = useLiveVehicles(displayCode)

  return (
    <div className="relative h-full w-full">
      {error ? (
        <div className="absolute top-4 left-4 z-10 flex items-center gap-3 rounded bg-red-600 px-3 py-2 text-sm text-white shadow">
          <span>{error}</span>
          <button
            type="button"
            className="rounded bg-white/20 px-2 py-0.5 text-xs"
            onClick={() => {
              clearDisplayCode()
              window.location.reload()
            }}
          >
            Change code
          </button>
        </div>
      ) : null}
      <Map
        initialViewState={{ longitude: 8.5417, latitude: 47.3769, zoom: 11 }}
        mapStyle={MAP_STYLE}
        style={{ width: "100%", height: "100%" }}
      >
        {vehicles.map((v) =>
          v.last_lat != null && v.last_lng != null ? (
            <Marker
              key={v.id}
              longitude={v.last_lng}
              latitude={v.last_lat}
              anchor="center"
            >
              <VehicleMarker heading={v.last_heading ?? 0} label={v.label} />
            </Marker>
          ) : null
        )}
      </Map>
    </div>
  )
}

function VehicleMarker({
  heading,
  label,
}: {
  heading: number
  label: string | null
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        aria-hidden
        style={{ transform: `rotate(${heading}deg)` }}
      >
        <path
          d="M12 2 L19 21 L12 17 L5 21 Z"
          fill="#2563eb"
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
