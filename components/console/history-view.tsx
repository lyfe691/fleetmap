"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { Pause, Play } from "lucide-react"
import { useTheme } from "next-themes"
import { Map as MapGL, Marker, Source, Layer, type MapRef } from "react-map-gl/maplibre"
import type { FeatureCollection } from "geojson"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { mapColors, mapStyleUrl, type MapTheme } from "@/lib/map-theme"
import { getBrowserClient } from "@/lib/supabase/browser"
import { useLocale, useTranslations } from "@/lib/i18n"
import { formatClock } from "@/lib/i18n/format"
import { positionAt, thinPoints, traceStats, type ReplayPoint } from "@/lib/replay"
import { useUnwrappedHeading } from "@/components/map/vehicle-marker"

const PAGE_SIZE = 1000
const MAX_PAGES = 25 // 25k fixes ≈ a full day at 3–4 s cadence
const MAX_RENDER_POINTS = 2500
const SPEEDS = [10, 30, 60, 120] as const

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`
}

export function HistoryView({ vehicles }: { vehicles: { id: string; reg: string }[] }) {
  const t = useTranslations()
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const theme: MapTheme = resolvedTheme === "dark" ? "dark" : "light"
  const colors = useMemo(() => mapColors(theme), [theme])
  const styleUrl = useMemo(() => mapStyleUrl(theme), [theme])

  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "")
  const [date, setDate] = useState(todayLocal)
  const [points, setPoints] = useState<ReplayPoint[]>([])
  const [rawCount, setRawCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The vehicle list arrives async; adopt the first one once it exists.
  useEffect(() => {
    if (!vehicleId && vehicles.length > 0) setVehicleId(vehicles[0].id)
  }, [vehicles, vehicleId])

  useEffect(() => {
    if (!vehicleId || !date) return
    const supabase = getBrowserClient()
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(start.getTime() + 24 * 3600 * 1000)
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      const all: ReplayPoint[] = []
      let hitCap = true
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error: selErr } = await supabase
          .from("vehicle_positions_public")
          .select("lat, lng, recorded_at")
          .eq("vehicle_id", vehicleId)
          .gte("recorded_at", start.toISOString())
          .lt("recorded_at", end.toISOString())
          .order("recorded_at", { ascending: true })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
        if (cancelled) return
        if (selErr) {
          setError(selErr.message)
          setLoading(false)
          return
        }
        const rows = (data ?? []) as { lat: number; lng: number; recorded_at: string }[]
        for (const r of rows) {
          all.push({ lat: r.lat, lng: r.lng, tMs: Date.parse(r.recorded_at) })
        }
        if (rows.length < PAGE_SIZE) {
          hitCap = false
          break
        }
      }
      setRawCount(all.length)
      setTruncated(hitCap)
      setPoints(thinPoints(all, MAX_RENDER_POINTS))
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [vehicleId, date])

  const stats = useMemo(() => traceStats(points), [points])
  const line = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features:
        points.length > 1
          ? [
              {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: points.map((p) => [p.lng, p.lat]),
                },
                properties: {},
              },
            ]
          : [],
    }),
    [points]
  )

  // Replay clock. Reset when the track changes; play resumes from the scrubber.
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(60)
  const [tMs, setTMs] = useState<number | null>(null)
  const startMs = points[0]?.tMs ?? null
  const endMs = points.length > 1 ? points[points.length - 1].tMs : null

  useEffect(() => {
    setPlaying(false)
    setTMs(null)
  }, [points])

  useEffect(() => {
    if (!playing || startMs == null || endMs == null) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last
      last = now
      setTMs((cur) => Math.min((cur ?? startMs) + dt * speed, endMs))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, startMs, endMs])

  useEffect(() => {
    if (playing && endMs != null && tMs != null && tMs >= endMs) setPlaying(false)
  }, [playing, tMs, endMs])

  const clock = tMs ?? startMs
  const pos = clock != null ? positionAt(points, clock) : null
  const angle = useUnwrappedHeading(pos?.bearing ?? null)

  const mapRef = useRef<MapRef>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  useEffect(() => {
    if (!mapLoaded || points.length < 2) return
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
    }
    mapRef.current?.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 70, maxZoom: 15, duration: 0 }
    )
  }, [mapLoaded, points])

  const hasTrack = points.length > 1

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[64rem] px-8 pt-7 pb-12">
        <h2 className="font-heading text-[1.75rem] font-semibold tracking-tight">
          {t("history.title")}
        </h2>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{t("history.subtitle")}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <NativeSelect
            aria-label={t("history.vehicle")}
            className="min-w-[11rem]"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {vehicles.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.reg}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label={t("history.date")}
            type="date"
            className="w-auto"
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
          />
          {loading ? <Spinner className="size-5" /> : null}
        </div>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <div className="relative mt-5 h-[26rem] overflow-hidden rounded-2xl border border-border shadow-[var(--shadow-card)]">
          <MapGL
            ref={mapRef}
            initialViewState={{ longitude: 8.23, latitude: 46.8, zoom: 6.6 }}
            mapStyle={styleUrl}
            style={{ width: "100%", height: "100%" }}
            onLoad={() => setMapLoaded(true)}
          >
            {hasTrack ? (
              <>
                <Source id="replay-line" type="geojson" data={line}>
                  <Layer
                    id="replay-line-casing"
                    type="line"
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{ "line-color": colors.routeCasing, "line-width": 7 }}
                  />
                  <Layer
                    id="replay-line-main"
                    type="line"
                    layout={{ "line-cap": "round", "line-join": "round" }}
                    paint={{ "line-color": colors.route, "line-width": 4, "line-opacity": 0.9 }}
                  />
                </Source>
                <Marker longitude={points[0].lng} latitude={points[0].lat}>
                  <span
                    className="block size-3.5 rounded-full border-2"
                    style={{ background: colors.pickup, borderColor: colors.markerStroke }}
                  />
                </Marker>
                <Marker
                  longitude={points[points.length - 1].lng}
                  latitude={points[points.length - 1].lat}
                >
                  <span
                    className="block size-3.5 rounded-full border-2"
                    style={{ background: colors.dropoff, borderColor: colors.markerStroke }}
                  />
                </Marker>
                {pos ? (
                  <Marker longitude={pos.lng} latitude={pos.lat}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/bubblebox-van-top.png"
                      alt=""
                      width={42}
                      height={42}
                      draggable={false}
                      className="select-none"
                      style={{
                        transform: `rotate(${angle}deg)`,
                        transition: "transform 0.3s ease-out",
                        filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.3))",
                      }}
                    />
                  </Marker>
                ) : null}
              </>
            ) : null}
          </MapGL>

          {!loading && !hasTrack ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background/55 backdrop-blur-[2px]">
              <p className="max-w-xs text-center text-sm text-muted-foreground">
                {t("history.empty")}
              </p>
            </div>
          ) : null}
        </div>

        {hasTrack && startMs != null && endMs != null ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-[var(--shadow-card)]">
            <button
              type="button"
              aria-label={playing ? t("history.pause") : t("history.play")}
              onClick={() => {
                if (!playing && tMs != null && tMs >= endMs) setTMs(startMs)
                setPlaying((p) => !p)
              }}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
            >
              {playing ? <Pause className="size-5" /> : <Play className="size-5 pl-0.5" />}
            </button>
            <span className="w-14 shrink-0 font-mono text-[0.9375rem] font-semibold tabular-nums">
              {clock != null ? formatClock(clock, locale) : "–"}
            </span>
            <input
              type="range"
              aria-label={t("history.scrubber")}
              className="min-w-0 flex-1"
              style={{ accentColor: colors.route }}
              min={startMs}
              max={endMs}
              step={1000}
              value={clock ?? startMs}
              onChange={(e) => setTMs(Number(e.target.value))}
            />
            <NativeSelect
              size="sm"
              aria-label={t("history.speed")}
              value={String(speed)}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {SPEEDS.map((s) => (
                <NativeSelectOption key={s} value={String(s)}>
                  {s}×
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {hasTrack ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatTile
              value={`${(stats.distanceM / 1000).toFixed(1)} km`}
              label={t("history.stat.distance")}
            />
            <StatTile value={fmtDuration(stats.durationMs)} label={t("history.stat.duration")} />
            <StatTile
              value={rawCount.toLocaleString()}
              label={t("history.stat.points")}
            />
          </div>
        ) : null}

        {truncated ? (
          <p className="mt-3 text-[0.8125rem] text-muted-foreground">
            {t("history.truncated", { n: rawCount.toLocaleString() })}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3.5 shadow-[var(--shadow-card)]">
      <div className="font-mono text-[1.25rem] leading-none font-semibold tracking-tight">
        {value}
      </div>
      <div className="mt-1.5 text-[0.75rem] text-muted-foreground">{label}</div>
    </div>
  )
}
