"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { Map as MapGL, Marker, Source, Layer, type MapRef } from "react-map-gl/maplibre"
import type { FeatureCollection } from "geojson"
import { CalendarIcon, Pause, Play, Truck } from "lucide-react"
import { de, enGB } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { mapColors, mapStyleUrl, type MapTheme } from "@/lib/map-theme"
import { getBrowserClient } from "@/lib/supabase/browser"
import { useLocale, useTranslations } from "@/lib/i18n"
import { formatClock, formatDay } from "@/lib/i18n/format"
import type { Locale } from "@/lib/settings/types"
import { positionAt, thinPoints, traceStats, type ReplayPoint } from "@/lib/replay"
import { useUnwrappedHeading } from "@/components/map/vehicle-marker"

const PAGE_SIZE = 1000
const MAX_PAGES = 25 // 25k fixes ≈ a full day at 3–4 s cadence
const MAX_RENDER_POINTS = 2500
const SPEEDS = [10, 30, 60, 120] as const
const EMPTY_POINTS: ReplayPoint[] = []

type LoadedTrack = {
  key: string
  points: ReplayPoint[]
  rawCount: number
  truncated: boolean
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`
}

export function HistoryView({
  vehicleId,
  vehicleReg,
}: {
  vehicleId: string | null
  vehicleReg: string | null
}) {
  const t = useTranslations()
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const theme: MapTheme = resolvedTheme === "dark" ? "dark" : "light"
  const colors = useMemo(() => mapColors(theme), [theme])
  const styleUrl = useMemo(() => mapStyleUrl(theme), [theme])

  const [date, setDate] = useState(() => toYMD(new Date()))
  const trackKey = vehicleId && date ? `${vehicleId}:${date}` : null
  const [loadedTrack, setLoadedTrack] = useState<LoadedTrack | null>(null)
  const [loadingFor, setLoadingFor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<{
    key: string
    message: string
  } | null>(null)
  const currentTrack = loadedTrack?.key === trackKey ? loadedTrack : null
  const points = currentTrack?.points ?? EMPTY_POINTS
  const rawCount = currentTrack?.rawCount ?? 0
  const truncated = currentTrack?.truncated ?? false
  const loading = trackKey != null && loadingFor === trackKey
  const error = loadError?.key === trackKey ? loadError.message : null

  useEffect(() => {
    if (!vehicleId || !date || !trackKey) return
    const supabase = getBrowserClient()
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(start.getTime() + 24 * 3600 * 1000)
    const requestKey = trackKey
    let cancelled = false

    const load = async () => {
      setLoadingFor(requestKey)
      setLoadError(null)
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
          setLoadError({ key: requestKey, message: selErr.message })
          setLoadingFor(null)
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
      setLoadedTrack({
        key: requestKey,
        points: thinPoints(all, MAX_RENDER_POINTS),
        rawCount: all.length,
        truncated: hitCap,
      })
      setLoadingFor(null)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [vehicleId, date, trackKey])

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
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-[1.75rem] font-semibold tracking-tight">
            {t("history.title")}
          </h2>
          {vehicleReg ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-[0.9375rem] font-semibold">
              <Truck className="size-4 text-muted-foreground" />
              {vehicleReg}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{t("history.subtitle")}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <HistoryDatePicker
            value={date}
            onChange={setDate}
            locale={locale}
            label={t("history.date")}
          />
          {loading ? <Spinner className="size-5" /> : null}
        </div>

        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

        <Card className="mt-5 gap-0 py-0">
          <div className="relative h-[26rem] border-b border-border">
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
            <CardFooter className="gap-4 py-4">
              <PlayButton
                playing={playing}
                label={playing ? t("history.pause") : t("history.play")}
                onClick={() => {
                  if (!playing && tMs != null && tMs >= endMs) setTMs(startMs)
                  setPlaying((p) => !p)
                }}
              />
              <span className="w-14 shrink-0 font-mono text-[0.9375rem] font-semibold tabular-nums">
                {clock != null ? formatClock(clock, locale) : "–"}
              </span>
              <ReplayScrubber
                min={startMs}
                max={endMs}
                value={clock ?? startMs}
                onSeek={setTMs}
                label={t("history.scrubber")}
              />
              <NativeSelect
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
            </CardFooter>
          ) : null}
        </Card>

        {hasTrack ? (
          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatCard
              value={`${(stats.distanceM / 1000).toFixed(1)} km`}
              label={t("history.stat.distance")}
            />
            <StatCard value={fmtDuration(stats.durationMs)} label={t("history.stat.duration")} />
            <StatCard
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

// date-fns ships no de-CH; plain de matches Swiss German month/weekday names.
const CALENDAR_LOCALE = { en: enGB, "de-CH": de } as const

function HistoryDatePicker({
  value,
  onChange,
  locale,
  label,
}: {
  value: string
  onChange: (ymd: string) => void
  locale: Locale
  label: string
}) {
  const [open, setOpen] = useState(false)
  const selected = new Date(`${value}T00:00:00`)
  const today = new Date()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" aria-label={label} />}>
        <CalendarIcon className="size-4 text-muted-foreground" />
        {formatDay(selected, locale)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            if (!d) return
            onChange(toYMD(d))
            setOpen(false)
          }}
          disabled={{ after: today }}
          endMonth={today}
          locale={CALENDAR_LOCALE[locale]}
          className="[--cell-size:--spacing(10)]"
        />
      </PopoverContent>
    </Popover>
  )
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

function PlayButton({
  playing,
  label,
  onClick,
}: {
  playing: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      onClick={onClick}
      className="size-12 shrink-0 rounded-full transition active:scale-95"
    >
      {playing ? (
        <Pause className="size-5 fill-current" />
      ) : (
        <Play className="ml-0.5 size-5 fill-current" />
      )}
    </Button>
  )
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="font-mono text-[1.375rem] font-semibold tracking-tight">
          {value}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

/**
 * The replay timeline: the ui Progress bar with pointer/keyboard seeking
 * layered on top (Progress itself is display-only). The wrapper's vertical
 * padding fattens the touch target beyond the visible track.
 */
function ReplayScrubber({
  min,
  max,
  value,
  onSeek,
  label,
}: {
  min: number
  max: number
  value: number
  onSeek: (tMs: number) => void
  label: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  const seekTo = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onSeek(Math.round(min + f * (max - min)))
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className="min-w-0 flex-1 cursor-pointer touch-none rounded-full py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(e) => {
        draggingRef.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        seekTo(e.clientX)
      }}
      onPointerMove={(e) => {
        if (draggingRef.current) seekTo(e.clientX)
      }}
      onPointerUp={() => {
        draggingRef.current = false
      }}
      onKeyDown={(e) => {
        const step = Math.max(1000, (max - min) / 100)
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault()
          onSeek(Math.min(max, value + step))
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault()
          onSeek(Math.max(min, value - step))
        }
      }}
    >
      <Progress
        value={pct}
        className="pointer-events-none [&_[data-slot=progress-indicator]]:transition-none [&_[data-slot=progress-track]]:h-4"
      />
    </div>
  )
}
