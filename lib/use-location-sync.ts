"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getDriverClient } from "@/lib/supabase/driver"
import {
  count as queueCount,
  deleteKey,
  enqueue,
  peekOldest,
  type QueuedPoint,
} from "@/lib/location-queue"
import type { Fix } from "@/lib/use-geolocation"

const MIN_INTERVAL_MS = 5000
const MIN_DISTANCE_M = 10
const HEARTBEAT_MS = 30000
const BACKSTOP_MS = 15000

function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

type PostResult = "ok" | "drop" | "auth" | "no-vehicle" | "retry"

async function postPoint(
  point: QueuedPoint,
  token: string
): Promise<PostResult> {
  try {
    const res = await fetch("/api/location", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(point),
    })
    if (res.ok) return "ok"
    if (res.status === 400) return "drop" // poison body — never deliverable
    if (res.status === 401) return "auth"
    if (res.status === 409) return "no-vehicle"
    return "retry" // 5xx / unexpected
  } catch {
    return "retry" // network down
  }
}

type SyncError = "no-vehicle" | "auth" | null

/**
 * Every fix is enqueued, then a single-flight drain sends oldest-first — "live"
 * is just an immediate drain of an empty queue. This guarantees ordering, no
 * dupes, and crash-safety, and removes any live-vs-flush race.
 */
export function useLocationSync(active: boolean) {
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [queued, setQueued] = useState(0)
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  )
  const [error, setError] = useState<SyncError>(null)

  const drainingRef = useRef(false)
  const stoppedRef = useRef(false) // 409 = terminal config error
  const lastEnqueuedPosRef = useRef<{ lat: number; lng: number } | null>(null)
  const lastEnqueuedAtRef = useRef(0)
  const lastFixRef = useRef<Fix | null>(null)

  const refreshQueued = useCallback(async () => {
    setQueued(await queueCount())
  }, [])

  const drain = useCallback(async () => {
    if (drainingRef.current || stoppedRef.current) return
    if (typeof navigator !== "undefined" && !navigator.onLine) return
    drainingRef.current = true
    try {
      const supabase = getDriverClient()
      for (;;) {
        const head = await peekOldest()
        if (!head) break

        const { data } = await supabase.auth.getSession()
        let token = data.session?.access_token
        if (!token) break

        let result = await postPoint(head.point, token)
        if (result === "auth") {
          const refreshed = await supabase.auth.refreshSession()
          token = refreshed.data.session?.access_token
          if (!token) {
            setError("auth")
            break
          }
          result = await postPoint(head.point, token)
        }

        if (result === "ok" || result === "drop") {
          await deleteKey(head.key)
          if (result === "ok") {
            setLastSentAt(Date.now())
            setError(null)
          }
          continue
        }
        if (result === "no-vehicle") {
          stoppedRef.current = true
          setError("no-vehicle")
          break
        }
        // "auth" (refresh failed) or "retry": stop, a later tick retries.
        if (result === "auth") setError("auth")
        break
      }
    } finally {
      drainingRef.current = false
      await refreshQueued()
    }
  }, [refreshQueued])

  const submit = useCallback(
    async (fix: Fix) => {
      lastEnqueuedPosRef.current = { lat: fix.lat, lng: fix.lng }
      lastEnqueuedAtRef.current = Date.now()
      await enqueue(fix)
      await refreshQueued()
      void drain()
    },
    [drain, refreshQueued]
  )

  // Wired into useGeolocation; gates before enqueueing.
  const onFix = useCallback(
    (fix: Fix) => {
      lastFixRef.current = fix
      const last = lastEnqueuedPosRef.current
      const movedEnough = !last || distanceM(last, fix) >= MIN_DISTANCE_M
      const intervalOk =
        Date.now() - lastEnqueuedAtRef.current >= MIN_INTERVAL_MS
      if (intervalOk && movedEnough) void submit(fix)
    },
    [submit]
  )

  // Online/offline: state is set only inside event callbacks (not the body).
  useEffect(() => {
    const onOnline = () => {
      setOnline(true)
      void drain()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [drain])

  useEffect(() => {
    if (!active) return
    stoppedRef.current = false // clear any prior 409-terminal on restart

    // Heartbeat: resend the last known fix on its own timer (independent of new
    // fix delivery) so a parked truck's last_seen_at stays fresh.
    const heartbeat = setInterval(() => {
      const fix = lastFixRef.current
      if (fix && Date.now() - lastEnqueuedAtRef.current >= HEARTBEAT_MS) {
        void submit(fix)
      }
    }, HEARTBEAT_MS)
    const backstop = setInterval(() => void drain(), BACKSTOP_MS)
    // Defer the initial count read + drain out of the synchronous effect body.
    queueMicrotask(() => {
      void refreshQueued()
      void drain()
    })

    return () => {
      clearInterval(heartbeat)
      clearInterval(backstop)
    }
  }, [active, drain, submit, refreshQueued])

  return { lastSentAt, queued, online, error, onFix }
}
