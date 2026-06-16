"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Screen Wake Lock with the mandatory re-acquire on visibilitychange — the OS
 * auto-releases the lock when the document is hidden and never restores it.
 */
export function useWakeLock() {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator
  const [active, setActive] = useState(false)
  const wantRef = useRef(false)
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  const acquire = useCallback(async () => {
    if (!wantRef.current) return
    try {
      const sentinel = await navigator.wakeLock.request("screen")
      sentinelRef.current = sentinel
      setActive(true)
      sentinel.addEventListener("release", () => {
        sentinelRef.current = null
        setActive(false)
      })
    } catch {
      setActive(false)
    }
  }, [])

  const enable = useCallback(() => {
    if (!("wakeLock" in navigator)) return
    wantRef.current = true
    void acquire()
  }, [acquire])

  const disable = useCallback(async () => {
    wantRef.current = false
    const sentinel = sentinelRef.current
    sentinelRef.current = null
    setActive(false)
    if (sentinel) {
      try {
        await sentinel.release()
      } catch {
        // already released
      }
    }
  }, [])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && wantRef.current) {
        void acquire()
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      if (sentinel) void sentinel.release()
    }
  }, [acquire])

  return { supported, active, enable, disable }
}
