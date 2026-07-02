"use client"

import { Home, Package, type LucideIcon } from "lucide-react"
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

const STOP_TYPE_ICON: Record<DispatchStop["stop_type"], LucideIcon> = {
  pickup: Package,
  dropoff: Home,
}

// Status → translation key + the pill tint/dot, mapped onto the app's existing
// status color system (success/warning/destructive/muted).
const STATUS_STYLE: Record<string, { key: TranslationKey; tint: string; dot: string }> = {
  planned: { key: "dispatch.status.planned", tint: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
  arrived: { key: "dispatch.status.arrived", tint: "bg-warning/15 text-warning-strong", dot: "bg-warning" },
  completed: { key: "dispatch.status.completed", tint: "bg-success/15 text-success", dot: "bg-success" },
  failed: { key: "dispatch.status.failed", tint: "bg-destructive/12 text-destructive", dot: "bg-destructive" },
  skipped: { key: "dispatch.status.skipped", tint: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
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
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bubblebox-van-tight.png" alt="" draggable={false} className="h-16 w-auto opacity-70" />
        <p className="max-w-xs text-sm text-muted-foreground">{t("dispatch.orders.empty")}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
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
        <div className="min-w-0">
          <div className="text-[1.0625rem] font-semibold">
            {order.customer_name ?? t("dispatch.orders.unnamedCustomer")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[0.75rem] text-muted-foreground">
            <span className="truncate">{order.external_ref}</span>
            {order.scheduled_date ? (
              <span className="rounded-full bg-muted px-2 py-0.5">{order.scheduled_date}</span>
            ) : null}
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

      <div className="mt-4 flex flex-col gap-2.5">
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

function StatusPill({ status }: { status: string }) {
  const t = useTranslations()
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.planned
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold ${style.tint}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {t(style.key)}
    </span>
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
  const Icon = STOP_TYPE_ICON[stop.stop_type]

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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-xl border border-border/70 bg-background px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand-strong">
        <Icon className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="text-[0.875rem] font-semibold">{t(STOP_TYPE_KEY[stop.stop_type])}</div>
        <div className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
          {stop.address ?? `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`}
        </div>
      </div>

      <StatusPill status={stop.status} />

      <div className="flex items-center gap-2">
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
              {t(STATUS_STYLE[s].key)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </div>
  )
}
