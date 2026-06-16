"use client"

import { useEffect, useState } from "react"

export type Fix = {
  lat: number
  lng: number
  heading: number | null
  speed: number | null
  accuracy: number | null
  recorded_at: string
}

export type GeoError = "denied" | "unavailable" | "timeout" | null

function toFix(pos: GeolocationPosition): Fix {
  const c = pos.coords
  // The API rejects heading >= 360 / negative and negative speed/accuracy; the
  // device reports null when stationary. Coerce to what /api/location accepts.
  let heading: number | null =
    typeof c.heading === "number" && Number.isFinite(c.heading)
      ? c.heading
      : null
  if (heading !== null) {
    if (heading < 0) heading = null
    else if (heading >= 360) heading = 0
  }
  const finite = (v: number | null) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null
  return {
    lat: c.latitude,
    lng: c.longitude,
    heading,
    speed: finite(c.speed),
    accuracy: finite(c.accuracy),
    recorded_at: new Date(pos.timestamp).toISOString(),
  }
}

export function useGeolocation(active: boolean, onFix: (fix: Fix) => void) {
  const supported =
    typeof navigator !== "undefined" && "geolocation" in navigator
  const [error, setError] = useState<GeoError>(null)

  // onFix is a stable useCallback from the sync hook, so this won't re-subscribe.
  useEffect(() => {
    if (!active || !supported) return
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null)
        onFix(toFix(pos))
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setError("denied")
        else if (err.code === err.POSITION_UNAVAILABLE) setError("unavailable")
        else if (err.code === err.TIMEOUT) setError("timeout")
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 27000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [active, supported, onFix])

  return { supported, error }
}
