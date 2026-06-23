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

async function mintSession(displayCode: string) {
  const res = await fetch("/api/dashboard-session", {
    method: "POST",
    headers: { "x-display-code": displayCode },
  })
  if (!res.ok) {
    throw new Error(`dashboard session denied (${res.status})`)
  }
  return (await res.json()) as { access_token: string; refresh_token: string }
}

/**
 * Snapshot-then-subscribe over the vehicles table for the dashboard.
 * Order matters: mint session -> setSession -> realtime.setAuth -> subscribe,
 * and snapshot only once SUBSCRIBED so no event in the gap is missed.
 */
export function useLiveVehicles(displayCode: string) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!displayCode) return

    setReady(false)
    setLoaded(false)
    setError(null)

    const supabase = getBrowserClient()
    const byId = new Map<string, Vehicle>()
    let channel: RealtimeChannel | null = null
    let cancelled = false
    // Releases the loader gate; set on the first snapshot or first surfaced
    // connection failure so a dead channel can't hang the loader forever.
    let resolved = false

    // Re-arm Realtime when supabase-js refreshes the session, so the socket
    // stays authed and the channel keeps delivering on a long-running TV.
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" && session) {
        void supabase.realtime.setAuth(session.access_token)
      } else if (event === "SIGNED_OUT") {
        // The long-running dashboard session ended (refresh token expired/revoked).
        // Surface it so the TV shows the error banner instead of silently freezing
        // on stale positions. Recovery is a reload (re-mints from the stored code).
        if (!cancelled) setError("Session ended — reload to reconnect.")
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
      // Live updates still ride the vehicles-table Realtime channel below.
      const { data, error: selErr } = await supabase
        .from("vehicles_public")
        .select(COLUMNS)
      if (cancelled) return
      if (selErr) {
        resolved = true
        setError(selErr.message)
        return
      }
      for (const v of (data ?? []) as Vehicle[]) apply(v, true)
      if (!cancelled) {
        resolved = true
        setError(null)
        setLoaded(true)
      }
    }

    const start = async () => {
      try {
        const { access_token, refresh_token } = await mintSession(displayCode)
        if (cancelled) return
        await supabase.auth.setSession({ access_token, refresh_token })
        await supabase.realtime.setAuth(access_token)
        if (cancelled) return
        setReady(true)

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
          .subscribe((status) => {
            if (cancelled) return
            if (status === "SUBSCRIBED") {
              void loadSnapshot()
              return
            }
            // A terminal failure before the first snapshot would otherwise hang
            // the loader; surface it so the shell shows the error banner.
            if (
              !resolved &&
              (status === "CHANNEL_ERROR" ||
                status === "TIMED_OUT" ||
                status === "CLOSED")
            ) {
              resolved = true
              setError(`realtime connection failed (${status})`)
            }
          })
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
  }, [displayCode])

  return { vehicles, error, ready, loaded }
}
