"use client"

import {
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { Truck } from "lucide-react"
import { Marker } from "react-map-gl/maplibre"

const STALE_AFTER_MS = 30_000

export function isStale(lastSeenAt: string | null, now: number): boolean {
  return (
    lastSeenAt == null || now - new Date(lastSeenAt).getTime() > STALE_AFTER_MS
  )
}

function reducedMotion(): boolean {
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

export const VehicleMarker = memo(function VehicleMarker({
  label,
  stale,
  selected,
  fill,
  surface,
}: {
  label: string | null
  stale: boolean
  selected: boolean
  fill: string
  surface: string
}) {
  const d = selected ? 54 : 44
  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-1.5"
      style={{ opacity: stale ? 0.6 : 1 }}
    >
      <div className="relative" style={{ width: d, height: d }}>
        {selected ? (
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{ background: fill, opacity: 0.35 }}
          />
        ) : null}
        <div
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: d,
            height: d,
            background: selected ? fill : surface,
            border: `3px solid ${fill}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
          }}
        >
          <Truck size={selected ? 22 : 19} color={selected ? surface : fill} />
        </div>
      </div>
      {label ? (
        <span className="rounded-full border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] leading-none font-semibold">
          {stale ? `${label} · stale` : label}
        </span>
      ) : null}
    </div>
  )
})

export const StopMarker = memo(function StopMarker({
  emphasized,
  terminal,
  fill,
  stroke,
}: {
  emphasized: boolean
  terminal: boolean
  fill: string
  stroke: string
}) {
  const r = emphasized ? 9 : 6
  const size = (r + 3) * 2
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      style={{ opacity: terminal ? 0.35 : 1 }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={emphasized ? 3 : 2}
      />
    </svg>
  )
})
