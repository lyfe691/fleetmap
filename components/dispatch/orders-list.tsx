"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { useTranslations } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { addReturnStop, cancelOrder, patchStop } from "@/lib/dispatch/actions"
import { useAsyncAction } from "@/lib/dispatch/use-async-action"
import type { DispatchOrder, DispatchStop, DispatchVehicle } from "@/lib/dispatch/use-dispatch-data"

const STATUS_OPTIONS = ["arrived", "completed", "failed", "skipped"] as const

const STOP_TYPE_KEY: Record<DispatchStop["stop_type"], TranslationKey> = {
  pickup: "dispatch.stop.pickup",
  dropoff: "dispatch.stop.dropoff",
}

const STATUS_KEY: Record<string, TranslationKey> = {
  planned: "dispatch.status.planned",
  arrived: "dispatch.status.arrived",
  completed: "dispatch.status.completed",
  failed: "dispatch.status.failed",
  skipped: "dispatch.status.skipped",
}

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
  const t = useTranslations()

  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("dispatch.orders.empty")}</p>
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
  const t = useTranslations()
  const { busy, error, run } = useAsyncAction(onChanged)

  const pickup = order.stops.find((s) => s.stop_type === "pickup")
  const hasDropoff = order.stops.some((s) => s.stop_type === "dropoff")

  const onAddReturn = () => {
    if (!pickup || !pickup.vehicle_id) return
    const vehicleId = pickup.vehicle_id
    void run(() =>
      addReturnStop({
        supabase,
        orderId: order.id,
        vehicleId,
        lat: pickup.lat,
        lng: pickup.lng,
        address: pickup.address,
        seq: nextSeqFor(vehicleId),
      })
    )
  }

  const onCancel = () => {
    void run(() => cancelOrder({ accessToken, source: order.source, externalRef: order.external_ref }))
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">
            {order.customer_name ?? t("dispatch.orders.unnamedCustomer")}
          </div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {order.external_ref}
            {order.scheduled_date ? ` · ${order.scheduled_date}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!hasDropoff ? (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAddReturn}>
              {busy ? <Spinner className="size-4" /> : t("dispatch.orders.addReturn")}
            </Button>
          ) : null}
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={onCancel}>
            {t("dispatch.orders.cancelOrder")}
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
  const t = useTranslations()
  const { busy, error, run } = useAsyncAction(onChanged)

  const onStatusChange = (status: string) => {
    void run(() => patchStop({ accessToken, stopId: stop.id, patch: { status } }))
  }

  const onReassign = (vehicleId: string) => {
    void run(() =>
      patchStop({
        accessToken,
        stopId: stop.id,
        patch: { vehicle_id: vehicleId, seq: nextSeqFor(vehicleId) },
      })
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <span className="min-w-16 font-medium">{t(STOP_TYPE_KEY[stop.stop_type])}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {stop.address ?? `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`}
      </span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
        {t(STATUS_KEY[stop.status] ?? "dispatch.status.planned")}
      </span>

      <NativeSelect
        size="sm"
        value={stop.vehicle_id ?? ""}
        disabled={busy}
        onChange={(e) => e.target.value && onReassign(e.target.value)}
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
        onChange={(e) => e.target.value && onStatusChange(e.target.value)}
      >
        <NativeSelectOption value="">{t("dispatch.orders.setStatus")}</NativeSelectOption>
        {STATUS_OPTIONS.map((s) => (
          <NativeSelectOption key={s} value={s}>
            {t(STATUS_KEY[s])}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
