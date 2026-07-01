"use client"

import { useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { addReturnStop, cancelOrder, patchStop } from "@/lib/dispatch/actions"
import type { DispatchOrder, DispatchStop, DispatchVehicle } from "@/lib/dispatch/use-dispatch-data"

const STATUS_OPTIONS = ["arrived", "completed", "failed", "skipped"] as const

export function OrdersList({
  orders,
  vehicles,
  nextSeqFor,
  accessToken,
  supabase,
  onChanged,
}: {
  orders: DispatchOrder[]
  vehicles: DispatchVehicle[]
  nextSeqFor: (vehicleId: string) => number
  accessToken: string
  supabase: SupabaseClient
  onChanged: () => void
}) {
  if (orders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No orders yet — create one from the New Order tab.</p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          vehicles={vehicles}
          nextSeqFor={nextSeqFor}
          accessToken={accessToken}
          supabase={supabase}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function OrderCard({
  order,
  vehicles,
  nextSeqFor,
  accessToken,
  supabase,
  onChanged,
}: {
  order: DispatchOrder
  vehicles: DispatchVehicle[]
  nextSeqFor: (vehicleId: string) => number
  accessToken: string
  supabase: SupabaseClient
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickup = order.stops.find((s) => s.stop_type === "pickup")
  const hasDropoff = order.stops.some((s) => s.stop_type === "dropoff")

  const onAddReturn = async () => {
    if (!pickup || !pickup.vehicle_id) return
    setBusy(true)
    setError(null)
    const result = await addReturnStop({
      supabase,
      orderId: order.id,
      vehicleId: pickup.vehicle_id,
      lat: pickup.lat,
      lng: pickup.lng,
      address: pickup.address,
      seq: nextSeqFor(pickup.vehicle_id),
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
  }

  const onCancel = async () => {
    setBusy(true)
    setError(null)
    const result = await cancelOrder({
      accessToken,
      source: order.source,
      externalRef: order.external_ref,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{order.customer_name ?? "Unnamed customer"}</div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {order.external_ref}
            {order.scheduled_date ? ` · ${order.scheduled_date}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!hasDropoff ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onAddReturn()}>
              {busy ? <Spinner className="size-4" /> : "Add return"}
            </Button>
          ) : null}
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void onCancel()}>
            Cancel order
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-col gap-2">
        {order.stops.map((stop) => (
          <StopRow
            key={stop.id}
            stop={stop}
            vehicles={vehicles}
            nextSeqFor={nextSeqFor}
            accessToken={accessToken}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  )
}

function StopRow({
  stop,
  vehicles,
  nextSeqFor,
  accessToken,
  onChanged,
}: {
  stop: DispatchStop
  vehicles: DispatchVehicle[]
  nextSeqFor: (vehicleId: string) => number
  accessToken: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onStatusChange = async (status: string) => {
    setBusy(true)
    setError(null)
    const result = await patchStop({ accessToken, stopId: stop.id, patch: { status } })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
  }

  const onReassign = async (vehicleId: string) => {
    setBusy(true)
    setError(null)
    const result = await patchStop({
      accessToken,
      stopId: stop.id,
      patch: { vehicle_id: vehicleId, seq: nextSeqFor(vehicleId) },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onChanged()
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <span className="min-w-16 font-medium capitalize">{stop.stop_type}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {stop.address ?? `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
        {stop.status}
      </span>

      <NativeSelect
        size="sm"
        value={stop.vehicle_id ?? ""}
        disabled={busy}
        onChange={(e) => e.target.value && void onReassign(e.target.value)}
      >
        {vehicles.map((v) => (
          <NativeSelectOption key={v.id} value={v.id}>
            {v.label ?? v.id.slice(0, 8)}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      <NativeSelect
        size="sm"
        value=""
        disabled={busy}
        onChange={(e) => e.target.value && void onStatusChange(e.target.value)}
      >
        <NativeSelectOption value="">Set status…</NativeSelectOption>
        {STATUS_OPTIONS.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {s}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
