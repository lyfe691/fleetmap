"use client"

import { useEffect, useState } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { getBrowserClient } from "@/lib/supabase/browser"

export type Stop = {
  id: string
  vehicle_id: string | null
  stop_type: "pickup" | "dropoff"
  seq: number
  lat: number
  lng: number
  status: string
  eta_at: string | null
}

const COLUMNS = "id, vehicle_id, stop_type, seq, lat, lng, status, eta_at"

/**
 * Second live channel for the dashboard: stops, on the SAME session the gate
 * established. Gate on `ready` (the vehicles hook has armed realtime auth) so
 * this only runs once authed; the vehicles hook's TOKEN_REFRESHED handler
 * re-arms the shared socket for both channels. Like the vehicles hook, the
 * snapshot is independent of the socket joining (last-write-wins keeps live
 * rows ahead of it), so a stalled channel can't leave stops empty. Returns
 * stops grouped by vehicle id, each list sorted by seq.
 */
export function useLiveStops(ready: boolean) {
  const [stopsByVehicle, setStopsByVehicle] = useState<Map<string, Stop[]>>(
    new Map()
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return

    const supabase = getBrowserClient()
    const byId = new Map<string, Stop>()
    let channel: RealtimeChannel | null = null
    let cancelled = false

    const publish = () => {
      if (cancelled) return
      const grouped = new Map<string, Stop[]>()
      for (const s of byId.values()) {
        if (s.vehicle_id == null) continue
        const list = grouped.get(s.vehicle_id) ?? []
        list.push(s)
        grouped.set(s.vehicle_id, list)
      }
      for (const list of grouped.values()) list.sort((a, b) => a.seq - b.seq)
      setStopsByVehicle(grouped)
    }

    const apply = (s: Stop, fromSnapshot = false) => {
      // Last-write-wins: the snapshot must not clobber a newer live event.
      if (fromSnapshot && byId.has(s.id)) return
      byId.set(s.id, s)
      publish()
    }

    const loadSnapshot = async () => {
      // Column-scoped view (0004): the snapshot never pulls address/order_id.
      const { data, error: selErr } = await supabase
        .from("stops_public")
        .select(COLUMNS)
      if (cancelled) return
      if (selErr) {
        setError(selErr.message)
        return
      }
      for (const s of (data ?? []) as Stop[]) apply(s, true)
    }

    channel = supabase
      .channel("stops-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stops" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            // REPLICA IDENTITY FULL (0004) puts the row in payload.old.
            const id = (payload.old as { id?: string }).id
            if (id) {
              byId.delete(id)
              publish()
            }
            return
          }
          apply(payload.new as Stop)
        }
      )
      .subscribe()

    // Snapshot regardless of the socket joining — last-write-wins keeps any
    // live row ahead of it, so a stalled channel can't leave stops empty.
    void loadSnapshot()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [ready])

  return { stopsByVehicle, error }
}
