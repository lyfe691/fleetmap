"use client"

import { useEffect, useState } from "react"

// Re-renders on an interval so wall-clock-derived state (e.g. staleness from
// last_seen_at) updates even when no new events arrive.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
