"use client"

import { useCallback, useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Stop } from "@/lib/use-live-stops"

export type DispatchStop = Stop & { order_id: string; address: string | null }

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

/** An order that still needs a van on at least one stop. */
export function isUnassigned(order: DispatchOrder): boolean {
  return order.stops.some((s) => s.vehicle_id == null)
}

export function isInProgress(order: DispatchOrder): boolean {
  return (
    !isUnassigned(order) &&
    order.stops.some((s) => s.status === "planned" || s.status === "arrived")
  )
}

/**
 * The dispatcher's working set: every vehicle it can assign to, and every
 * order + its stops (dispatcher RLS is full-read on both, no status filter —
 * `orders.status` never advances past 'assigned' today, per M9's deliberate
 * scope cut, so filtering by it would just be dead code).
 *
 * Vehicles are static reference data in this console (nothing here ever
 * mutates one) and are fetched once; only `orders` is refetched after a
 * mutation, so a single-stop status change doesn't also re-pull the vehicle
 * list or blank a part of the screen that didn't change.
 */
export function useDispatchData(supabase: SupabaseClient) {
  const [vehicles, setVehicles] = useState<DispatchVehicle[]>([])
  const [orders, setOrders] = useState<DispatchOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void supabase
      .from("vehicles")
      .select("id, label")
      .order("label")
      .then(({ data, error: vehiclesError }) => {
        if (cancelled) return
        if (vehiclesError) {
          setError(vehiclesError.message)
          return
        }
        setVehicles((data ?? []) as DispatchVehicle[])
      })
    return () => {
      cancelled = true
    }
  }, [supabase])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: ordersError } = await supabase
      .from("orders")
      .select("id, external_ref, source, customer_name, status, scheduled_date, stops(*)")
      .order("created_at", { ascending: false })
    if (ordersError) {
      setError(ordersError.message)
      setLoading(false)
      return
    }
    setOrders(
      ((data ?? []) as unknown as DispatchOrder[]).map((o) => ({
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
