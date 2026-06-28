"use client"

import { useEffect, useState } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { getBrowserClient } from "@/lib/supabase/browser"

export type Vehicle = {
  id: string
  label: string | null
  status: string
  last_lat: number | null
  last_lng: number | null
  last_heading: number | null
  last_speed: number | null
  last_seen_at: string | null
  area_id: string | null
}

const COLUMNS =
  "id, label, status, last_lat, last_lng, last_heading, last_speed, last_seen_at, area_id"

/**
 * Live vehicles for the dashboard. The gate has already established the session
 * (connectDashboard), so this arms Realtime auth, opens the live channel, then
 * loads the snapshot.
 *
 * The loader is released by the snapshot alone — a fast, reliable select — never
 * by the websocket. Realtime is a best-effort overlay: the channel is opened
 * first so live rows flow in (last-write-wins keeps them ahead of the snapshot),
 * but a vehicle that stops updating simply ages into the console's stale state.
 * So a slow or stalled socket can't hang the view — the snapshot stands on its
 * own, and live updates layer on once the channel joins.
 */
export function useLiveVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const supabase = getBrowserClient()
    const byId = new Map<string, Vehicle>()
    let channel: RealtimeChannel | null = null
    let cancelled = false

    // Re-arm Realtime when supabase-js refreshes the session, so the socket
    // stays authed and the channel keeps delivering on a long-running TV.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) {
        void supabase.realtime.setAuth(session.access_token)
      } else if (event === "SIGNED_OUT" && !cancelled) {
        // The dashboard session ended (refresh token expired/revoked). Surface
        // it so the TV shows the error banner instead of freezing on stale
        // positions. Recovery is a reload (re-mints from the stored code).
        setError("Session ended — reload to reconnect.")
      }
    })

    const publish = () => {
      if (!cancelled) setVehicles(Array.from(byId.values()))
    }

    const apply = (v: Vehicle, fromSnapshot = false) => {
      // Last-write-wins: the snapshot must not clobber a newer live event.
      if (fromSnapshot && byId.has(v.id)) return
      if (v.last_lat == null || v.last_lng == null) byId.delete(v.id)
      else byId.set(v.id, v)
      publish()
    }

    const loadSnapshot = async () => {
      // Column-scoped view (0003): the snapshot never pulls sensitive columns.
      const { data, error: selErr } = await supabase
        .from("vehicles_public")
        .select(COLUMNS)
      if (cancelled) return
      if (selErr) {
        setError(selErr.message)
        return
      }
      for (const v of (data ?? []) as Vehicle[]) apply(v, true)
      setError(null)
      setLoaded(true)
    }

    const start = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (cancelled) return
        if (!session) {
          setError("Session unavailable — reload to reconnect.")
          return
        }
        await supabase.realtime.setAuth(session.access_token)
        if (cancelled) return
        setReady(true)

        // Open the live channel first so events start flowing, then snapshot.
        // The snapshot doesn't wait on the channel joining — it releases the
        // loader on its own.
        channel = supabase
          .channel("vehicles-live")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "vehicles" },
            (payload) => {
              if (payload.eventType === "DELETE") {
                const id = (payload.old as { id?: string }).id
                if (id) {
                  byId.delete(id)
                  publish()
                }
                return
              }
              apply(payload.new as Vehicle)
            }
          )
          .subscribe()

        await loadSnapshot()
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to connect")
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      authSub.subscription.unsubscribe()
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  return { vehicles, error, ready, loaded }
}
