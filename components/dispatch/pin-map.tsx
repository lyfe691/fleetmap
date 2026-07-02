"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useMemo } from "react"
import { useTheme } from "next-themes"
import { Map as MapGL, Marker } from "react-map-gl/maplibre"
import { mapColors, mapStyleUrl, type MapTheme } from "@/lib/map-theme"
import { useTranslations } from "@/lib/i18n"

/**
 * A small, focused click-to-place map for the dispatcher's order-intake form —
 * deliberately NOT FleetMapView, which is built around rendering a whole
 * fleet's live vehicles/routes and has no click affordance. This only needs
 * the shared tile style/theme (lib/map-theme.ts) and a single pin, plus its
 * own overlay label + coordinate readout so the form column stays clean.
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
  const t = useTranslations()
  const { resolvedTheme } = useTheme()
  const theme: MapTheme = resolvedTheme === "dark" ? "dark" : "light"
  const styleUrl = useMemo(() => mapStyleUrl(theme), [theme])
  const colors = useMemo(() => mapColors(theme), [theme])
  const hasPin = lat != null && lng != null

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-2xl border border-border shadow-[var(--shadow-card)] lg:h-[30rem]">
      <MapGL
        initialViewState={{
          longitude: lng ?? 8.23,
          latitude: lat ?? 46.8,
          zoom: hasPin ? 13 : 7.2,
        }}
        mapStyle={styleUrl}
        style={{ width: "100%", height: "100%" }}
        cursor="crosshair"
        onClick={(e) => onPick(e.lngLat.lat, e.lngLat.lng)}
      >
        {hasPin ? (
          <Marker longitude={lng} latitude={lat}>
            <div
              className="size-8 rounded-full border-2 shadow-md"
              style={{ background: colors.pickup, borderColor: colors.markerStroke }}
            />
          </Marker>
        ) : null}
      </MapGL>

      {/* overlay: label pill (top-left) + live coordinate readout (bottom-left) */}
      <div className="pointer-events-none absolute top-3 left-3 rounded-full border border-border bg-surface/85 px-3 py-1.5 text-[0.8125rem] font-semibold shadow-sm backdrop-blur">
        {t("dispatch.form.pinLabel")}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-border bg-surface/85 px-3 py-1.5 text-[0.8125rem] shadow-sm backdrop-blur">
        <span
          className={`size-2 rounded-full ${hasPin ? "bg-brand" : "bg-muted-foreground/50"}`}
        />
        <span className={hasPin ? "font-mono font-medium" : "text-muted-foreground"}>
          {hasPin
            ? t("dispatch.form.locationSet", { lat: lat.toFixed(5), lng: lng.toFixed(5) })
            : t("dispatch.form.noLocation")}
        </span>
      </div>
    </div>
  )
}
