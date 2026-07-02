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
 * re-arms the shared socket for both channels. The snapshot runs immediately
 * (a stalled channel can't leave stops empty) AND again on every SUBSCRIBED —
 * initial join and each rejoin — because Realtime does not replay events
 * missed during the join gap or a socket outage. Each snapshot replaces the
 * store wholesale; rows touched by a live event while it was in flight win
 * over it (including deletions). Returns stops grouped by vehicle id, each
 * list sorted by seq.
 */
export function useLiveStops(ready: boolean) {
  const [stopsByVehicle, setStopsByVehicle] = useState<Map<string, Stop[]>>(
    new Map()
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return

    const supabase = getBrowserClient()
    let byId = new Map<string, Stop>()
    let touched = new Set<string>()
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

    const loadSnapshot = async () => {
      touched = new Set()
      // Column-scoped view (0004): the snapshot never pulls address/order_id.
      // Bounded read: active stops always, terminal ones only from the last
      // 24 h — the table grows forever but the TV shows a day's operation.
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const { data, error: selErr } = await supabase
        .from("stops_public")
        .select(COLUMNS)
        .or(`status.in.(planned,arrived),eta_at.gte.${cutoff}`)
      if (cancelled) return
      if (selErr) {
        setError(selErr.message)
        return
      }
      const fresh = new Map<string, Stop>()
      for (const s of (data ?? []) as Stop[]) fresh.set(s.id, s)
      // Live events that raced this snapshot win over it — an updated row keeps
      // its newer value, a deleted row stays deleted.
      for (const id of touched) {
        const live = byId.get(id)
        if (live) fresh.set(id, live)
        else fresh.delete(id)
      }
      byId = fresh
      setError(null)
      publish()
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
              touched.add(id)
              publish()
            }
            return
          }
          const s = payload.new as Stop
          byId.set(s.id, s)
          touched.add(s.id)
          publish()
        }
      )
      // Fires on the initial join and every rejoin after a socket drop —
      // re-snapshot both times, since missed events are never replayed.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadSnapshot()
      })

    // Snapshot regardless of the socket joining, so a stalled channel can't
    // leave stops empty.
    void loadSnapshot()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [ready])

  return { stopsByVehicle, error }
}
