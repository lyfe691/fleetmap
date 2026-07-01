"use client"

import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"

export type DispatchStop = {
  id: string
  order_id: string
  vehicle_id: string | null
  stop_type: "pickup" | "dropoff"
  seq: number
  lat: number
  lng: number
  address: string | null
  status: string
  eta_at: string | null
}

export type DispatchOrder = {
  id: string
  external_ref: string
  source: string
  customer_name: string | null
  status: string
  scheduled_date: string | null
  stops: DispatchStop[]
}

export type DispatchVehicle = { id: string; label: string | null }

/**
 * The dispatcher's working set: every vehicle it can assign to, and every
 * order + its stops (dispatcher RLS is full-read on both, no status filter —
 * `orders.status` never advances past 'assigned' today, per M9's deliberate
 * scope cut, so filtering by it would just be dead code).
 */
export function useDispatchData(supabase: SupabaseClient) {
  const [vehicles, setVehicles] = useState<DispatchVehicle[]>([])
  const [orders, setOrders] = useState<DispatchOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [vehiclesRes, ordersRes] = await Promise.all([
      supabase.from("vehicles").select("id, label").order("label"),
      supabase
        .from("orders")
        .select("id, external_ref, source, customer_name, status, scheduled_date, stops(*)")
        .order("created_at", { ascending: false }),
    ])
    if (vehiclesRes.error) {
      setError(vehiclesRes.error.message)
      setLoading(false)
      return
    }
    if (ordersRes.error) {
      setError(ordersRes.error.message)
      setLoading(false)
      return
    }
    setVehicles((vehiclesRes.data ?? []) as DispatchVehicle[])
    setOrders(
      ((ordersRes.data ?? []) as unknown as DispatchOrder[]).map((o) => ({
        ...o,
        stops: [...o.stops].sort((a, b) => a.seq - b.seq),
      }))
    )
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Highest seq in use per vehicle, across every stop on every order — the
  // unique constraint is (vehicle_id, seq) globally, not scoped to one order,
  // so a new stop always needs max+1 for its vehicle.
  const nextSeqFor = useCallback(
    (vehicleId: string): number => {
      let max = 0
      for (const o of orders) {
        for (const s of o.stops) {
          if (s.vehicle_id === vehicleId && s.seq > max) max = s.seq
        }
      }
      return max + 1
    },
    [orders]
  )

  return { vehicles, orders, loading, error, refresh, nextSeqFor }
}
