"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useMemo } from "react"
import { useTheme } from "next-themes"
import { Map as MapGL, Marker } from "react-map-gl/maplibre"
import { mapColors, mapStyleUrl, type MapTheme } from "@/lib/map-theme"

/**
 * A small, focused click-to-place map for the dispatcher's order-intake form —
 * deliberately NOT FleetMapView, which is built around rendering a whole
 * fleet's live vehicles/routes and has no click affordance. This only needs
 * the shared tile style/theme (lib/map-theme.ts) and a single pin.
 *
 * Height is a fixed, explicit class — never `h-full`. A percentage height
 * only resolves if every ancestor up the tree has a definite height too; one
 * broken link (e.g. a grid row below the `lg` breakpoint) silently collapses
 * it. Fixed height always renders, on any layout.
 */
export function PinMap({
  lat,
  lng,
  onPick,
}: {
  lat: number | null
  lng: number | null
  onPick: (lat: number, lng: number) => void
}) {
  const { resolvedTheme } = useTheme()
  const theme: MapTheme = resolvedTheme === "dark" ? "dark" : "light"
  const styleUrl = useMemo(() => mapStyleUrl(theme), [theme])
  const colors = useMemo(() => mapColors(theme), [theme])

  return (
    <div className="h-80 w-full overflow-hidden rounded-2xl border border-border lg:h-[28rem]">
      <MapGL
        initialViewState={{
          longitude: lng ?? 8.23,
          latitude: lat ?? 46.8,
          zoom: lat != null ? 13 : 7.2,
        }}
        mapStyle={styleUrl}
        style={{ width: "100%", height: "100%" }}
        cursor="crosshair"
        onClick={(e) => onPick(e.lngLat.lat, e.lngLat.lng)}
      >
        {lat != null && lng != null ? (
          <Marker longitude={lng} latitude={lat} anchor="bottom">
            <div
              className="size-8 -translate-y-1 rounded-full border-2 shadow-md"
              style={{ background: colors.pickup, borderColor: colors.markerStroke }}
            />
          </Marker>
        ) : null}
      </MapGL>
    </div>
  )
}
