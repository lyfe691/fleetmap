"use client"

import {
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { Marker } from "react-map-gl/maplibre"
import { useTranslations } from "@/lib/i18n"

const STALE_AFTER_MS = 30_000

export function isStale(lastSeenAt: string | null, now: number): boolean {
  return (
    lastSeenAt == null || now - new Date(lastSeenAt).getTime() > STALE_AFTER_MS
  )
}

function reducedMotion(): boolean {
  if (typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-reduce-motion") === "true") {
    return true
  }
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

// Larger than any real inter-tick movement (~140 m at 100 km/h): such a jump
// is a background-tab catch-up (rAF frozen while Realtime kept moving the
// target), a reconnect gap, or a sim reset — snap, don't glide across town.
export const SNAP_JUMP_M = 300

export function approxMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const dLat = (b.lat - a.lat) * 111_320
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

function useGlide(targetLng: number, targetLat: number, durationMs: number) {
  const [pos, setPos] = useState({ lng: targetLng, lat: targetLat })
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const from = { ...posRef.current }
    const to = { lng: targetLng, lat: targetLat }
    const settled =
      Math.abs(to.lng - from.lng) + Math.abs(to.lat - from.lat) < 1e-7
    if (settled || reducedMotion() || approxMeters(from, to) > SNAP_JUMP_M) {
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

export function InterpolatedMarker({
  longitude,
  latitude,
  anchor,
  onClick,
  style,
  children,
}: {
  longitude: number
  latitude: number
  anchor?: ComponentProps<typeof Marker>["anchor"]
  onClick?: ComponentProps<typeof Marker>["onClick"]
  style?: ComponentProps<typeof Marker>["style"]
  children: ReactNode
}) {
  const pos = useGlide(longitude, latitude, 5000)
  // Without subpixel positioning maplibre rounds the marker to whole pixels;
  // at full-route zoom a glide advances <1px/frame and stair-steps. Moving
  // markers only — static stop markers keep the crisp rounded default.
  return (
    <Marker
      longitude={pos.lng}
      latitude={pos.lat}
      anchor={anchor}
      onClick={onClick}
      style={style}
      subpixelPositioning
    >
      {children}
    </Marker>
  )
}

// CSS transitions interpolate rotate() numerically, so 358° → 2° would spin
// -356° the long way round. Accumulate an unwrapped angle instead, feeding the
// shortest signed delta each update; a null heading holds the last orientation.
export function useUnwrappedHeading(heading: number | null): number {
  const ref = useRef<{ raw: number; acc: number } | null>(null)
  if (heading != null) {
    if (ref.current == null) {
      ref.current = { raw: heading, acc: heading }
    } else if (heading !== ref.current.raw) {
      let delta = (heading - ref.current.raw) % 360
      if (delta > 180) delta -= 360
      else if (delta < -180) delta += 360
      ref.current = { raw: heading, acc: ref.current.acc + delta }
    }
  }
  return ref.current?.acc ?? 0
}

export const VehicleMarker = memo(function VehicleMarker({
  label,
  stale,
  selected,
  fill,
  heading,
}: {
  label: string | null
  stale: boolean
  selected: boolean
  fill: string
  heading: number | null
}) {
  const t = useTranslations()
  const angle = useUnwrappedHeading(heading)
  const w = selected ? 56 : 46
  return (
    <div
      className="relative flex cursor-pointer items-center justify-center"
      style={{ width: w, height: w }}
    >
      {/* status-coloured pulse on the selected van (sits behind, never rotates) */}
      {selected ? (
        <span
          className="absolute m-auto animate-ping rounded-full"
          style={{ width: w * 0.72, height: w * 0.72, background: fill, opacity: 0.3 }}
        />
      ) : null}
      {/* Top-down van rotated to its heading — the source image points north at
          0°, and CSS rotate is clockwise, matching a compass bearing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/bubblebox-van-top.png"
        alt=""
        width={w}
        height={w}
        draggable={false}
        className="relative select-none"
        style={{
          transform: `rotate(${angle}deg)`,
          transition: "transform 0.5s ease-out",
          filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.3))",
        }}
      />
      {/* Identity label — upright, below the van (doesn't rotate). Stale is shown
          here (the status dot greys + a "stale" suffix), never on the van itself. */}
      {label ? (
        <span className="absolute top-full left-1/2 mt-1.5 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[0.75rem] leading-none font-semibold whitespace-nowrap text-foreground shadow-md">
          <span className="size-2 shrink-0 rounded-full" style={{ background: fill }} />
          {stale ? `${label} · ${t("rail.stale")}` : label}
        </span>
      ) : null}
    </div>
  )
})

export type StopState = "done" | "next" | "upcoming"

/**
 * Fleet-tier stop glyph: a small waypoint dot sitting on the route line —
 * texture of the route, not a marker. Ring colour mirrors the line (route
 * accent, late red, or traveled grey when done); each van's next stop is a
 * touch larger so the fleet view still shows where everyone is headed.
 */
export const StopDot = memo(function StopDot({
  fill,
  ring,
  emphasized = false,
  dimmed = false,
}: {
  fill: string
  ring: string
  emphasized?: boolean
  dimmed?: boolean
}) {
  const r = emphasized ? 5 : 3.5
  const size = (r + 2.5) * 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ opacity: dimmed ? 0.15 : 1 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={fill}
        stroke={ring}
        strokeWidth={emphasized ? 2.5 : 2}
      />
    </svg>
  )
})

/**
 * Focus-tier stop glyph: the selected van's stops as seq-numbered badges.
 * done = muted (pre-mixed fill, full opacity — a faded element fails number
 * contrast over light tiles), next = accent with a static halo (+ optional
 * ETA pill below, van-label pattern), upcoming = surface fill with an accent
 * border. aria-hidden: the itinerary is the accessible surface for stops.
 */
export const StopBadge = memo(function StopBadge({
  number,
  state,
  fill,
  text,
  border,
  etaLabel = null,
  etaLate = false,
}: {
  number: number
  state: StopState
  fill: string
  text: string
  border?: string
  etaLabel?: string | null
  etaLate?: boolean
}) {
  const size = state === "next" ? 30 : state === "upcoming" ? 24 : 20
  return (
    <div
      aria-hidden
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {state === "next" ? (
        <span
          className="absolute rounded-full"
          style={{ inset: -5, background: fill, opacity: 0.25 }}
        />
      ) : null}
      <span
        // mono + tabular-nums keeps 1/11/10 the same width; leading-none + a
        // whole-pixel lift (matches ItineraryBadge; fractional would blur on
        // the 1x-DPR TV) corrects the optical-low sit of digits in a circle.
        className="relative flex h-full w-full items-center justify-center rounded-full font-mono font-semibold leading-none tabular-nums"
        style={{
          background: fill,
          color: text,
          fontSize: state === "next" ? 13 : 11,
          border: border ? `2px solid ${border}` : undefined,
          boxShadow: "0 1px 2px rgb(0 0 0 / 0.25)",
        }}
      >
        <span style={{ transform: "translateY(-1px)" }}>{number}</span>
      </span>
      {etaLabel ? (
        <span
          className={`absolute top-full left-1/2 mt-1.5 -translate-x-1/2 rounded-full bg-surface px-2 py-1 text-[0.6875rem] leading-none font-semibold whitespace-nowrap shadow-md ${
            etaLate ? "text-destructive" : "text-foreground"
          }`}
        >
          {etaLabel}
        </span>
      ) : null}
    </div>
  )
})
