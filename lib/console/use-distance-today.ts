"use client"

import { useEffect, useState } from "react"
import { getBrowserClient } from "@/lib/supabase/browser"

type DistanceState = { km: number | null; loading: boolean }

// Server-side "distance driven today" (0010 RPC) — avoids pulling a full day of
// positions to the client. `loading` is true while the RPC is in flight; `km`
// is null on error (including the 0010 migration not yet being applied).
export function useDistanceToday(vehicleId: string | null): DistanceState {
  const [state, setState] = useState<DistanceState>({ km: null, loading: false })

  useEffect(() => {
    if (!vehicleId) {
      setState({ km: null, loading: false })
      return
    }
    const supabase = getBrowserClient()
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Zurich",
    }).format(new Date())
    let cancelled = false
    setState({ km: null, loading: true })
    void supabase
      .rpc("vehicle_distance_m", { p_vehicle_id: vehicleId, p_day: day })
      .then(({ data, error }) => {
        if (cancelled) return
        setState({
          km: error || data == null ? null : Number(data) / 1000,
          loading: false,
        })
      })
    return () => {
      cancelled = true
    }
  }, [vehicleId])

  return state
}
