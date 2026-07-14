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

function useGlide(targetLng: number, targetLat: number, durationMs: number) {
  const [pos, setPos] = useState({ lng: targetLng, lat: targetLat })
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const from = { ...posRef.current }
    const to = { lng: targetLng, lat: targetLat }
    const settled =
      Math.abs(to.lng - from.lng) + Math.abs(to.lat - from.lat) < 1e-7
    if (settled || reducedMotion()) {
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
  children,
}: {
  longitude: number
  latitude: number
  anchor?: ComponentProps<typeof Marker>["anchor"]
  onClick?: ComponentProps<typeof Marker>["onClick"]
  children: ReactNode
}) {
  const pos = useGlide(longitude, latitude, 5000)
  return (
    <Marker longitude={pos.lng} latitude={pos.lat} anchor={anchor} onClick={onClick}>
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

export type StopMarkerState = "done" | "next" | "upcoming"

/**
 * Three-state stop language, legible at ~20 stops per van:
 * - done: small, grey, a check — quietly behind the van
 * - next: larger, accent halo (red-tinted when the van is late) — the one that matters
 * - upcoming: neutral, the stop-type colour
 * Pickup vs dropoff is shape, not just colour: pickups are circles, dropoffs
 * rounded squares.
 */
export const StopMarker = memo(function StopMarker({
  stopType,
  state,
  fill,
  doneFill,
  lateFill,
  stroke,
  late = false,
}: {
  stopType: "pickup" | "dropoff"
  state: StopMarkerState
  fill: string
  doneFill: string
  lateFill: string
  stroke: string
  late?: boolean
}) {
  const r = state === "next" ? 9 : 6
  const pad = state === "next" ? 6 : 3
  const size = (r + pad) * 2
  const c = size / 2
  const color =
    state === "done" ? doneFill : state === "next" && late ? lateFill : fill
  const sw = state === "next" ? 3 : 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ opacity: state === "done" ? 0.55 : 1 }}
    >
      {state === "next" ? (
        stopType === "pickup" ? (
          <circle cx={c} cy={c} r={r + 4} fill={color} opacity={0.25} />
        ) : (
          <rect
            x={c - r - 4}
            y={c - r - 4}
            width={(r + 4) * 2}
            height={(r + 4) * 2}
            rx={(r + 4) * 0.35}
            fill={color}
            opacity={0.25}
          />
        )
      ) : null}
      {stopType === "pickup" ? (
        <circle cx={c} cy={c} r={r} fill={color} stroke={stroke} strokeWidth={sw} />
      ) : (
        <rect
          x={c - r}
          y={c - r}
          width={r * 2}
          height={r * 2}
          rx={r * 0.35}
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        />
      )}
      {state === "done" ? (
        <path
          d={`M ${c - r * 0.5} ${c} l ${r * 0.36} ${r * 0.4} l ${r * 0.62} -${r * 0.75}`}
          stroke={stroke}
          strokeWidth={1.8}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  )
})
