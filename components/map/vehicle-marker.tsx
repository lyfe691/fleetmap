"use client"

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Marker } from "react-map-gl/maplibre"

export const STALE_AFTER_MS = 30_000

function useGlide(targetLng: number, targetLat: number, durationMs: number) {
  const [pos, setPos] = useState({ lng: targetLng, lat: targetLat })
  const posRef = useRef(pos)
  posRef.current = pos

  useEffect(() => {
    const from = { ...posRef.current }
    const to = { lng: targetLng, lat: targetLat }
    if (Math.abs(to.lng - from.lng) + Math.abs(to.lat - from.lat) < 1e-7) {
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
    <Marker
      longitude={pos.lng}
      latitude={pos.lat}
      anchor={anchor}
      onClick={onClick}
    >
      {children}
    </Marker>
  )
}

export function VehicleMarker({
  heading,
  label,
  stale,
}: {
  heading: number
  label: string | null
  stale: boolean
}) {
  const fill = stale ? "#9ca3af" : "#2563eb"
  return (
    <div
      className="flex cursor-pointer flex-col items-center gap-0.5"
      style={{ opacity: stale ? 0.55 : 1 }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        aria-hidden
        style={{
          transform: `rotate(${heading}deg)`,
          filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))",
        }}
      >
        <rect
          x="6"
          y="3"
          width="12"
          height="18"
          rx="3"
          fill={fill}
          stroke="#fff"
          strokeWidth="1.3"
        />
        <path
          d="M7.6 7.4 Q12 5.8 16.4 7.4 L15.4 9.6 Q12 8.7 8.6 9.6 Z"
          fill="#fff"
          opacity="0.9"
        />
        <rect x="8.4" y="15" width="7.2" height="3" rx="1" fill="#fff" opacity="0.45" />
        <rect
          x="4.7"
          y="8.2"
          width="1.6"
          height="2.2"
          rx="0.6"
          fill={fill}
          stroke="#fff"
          strokeWidth="0.7"
        />
        <rect
          x="17.7"
          y="8.2"
          width="1.6"
          height="2.2"
          rx="0.6"
          fill={fill}
          stroke="#fff"
          strokeWidth="0.7"
        />
      </svg>
      {label ? (
        <span className="rounded bg-black/70 px-1 text-[10px] leading-tight text-white">
          {stale ? `${label} · stale` : label}
        </span>
      ) : null}
    </div>
  )
}

export function StopMarker({
  stopType,
  status,
  emphasized,
}: {
  stopType: "pickup" | "dropoff"
  status: string
  emphasized: boolean
}) {
  const terminal = status !== "planned" && status !== "arrived"
  const fill = stopType === "pickup" ? "#16a34a" : "#9333ea"
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
        stroke="white"
        strokeWidth={emphasized ? 3 : 2}
      />
    </svg>
  )
}
