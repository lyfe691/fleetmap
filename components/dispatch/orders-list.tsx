"use client"

import { useState, type ReactNode } from "react"
import { Home, Package, type LucideIcon } from "lucide-react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { useLocale, useTranslations } from "@/lib/i18n"
import { formatClock } from "@/lib/i18n/format"
import type { TranslationKey } from "@/lib/i18n/en"
import { addReturnStop, assignOrder, cancelOrder, patchStop } from "@/lib/dispatch/actions"
import { useAsyncAction } from "@/lib/dispatch/use-async-action"
import {
  isUnassigned,
  type DispatchOrder,
  type DispatchStop,
  type DispatchVehicle,
} from "@/lib/dispatch/use-dispatch-data"

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
  const unassigned = orders.filter(isUnassigned)
  const assigned = orders.filter((o) => !isUnassigned(o))

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
    <div className="flex flex-col gap-8">
      {unassigned.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading count={unassigned.length} accent>
            {t("dispatch.orders.needsVan")}
          </SectionHeading>
          <div className="flex flex-col gap-4">
            {unassigned.map((order) => (
              <UnassignedOrderCard
                key={order.id}
                order={order}
                vehicles={vehicles}
                nextSeqFor={nextSeqFor}
                accessToken={accessToken}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      ) : null}

      {assigned.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeading count={assigned.length}>
            {t("dispatch.orders.assignedSection")}
          </SectionHeading>
          <div className="flex flex-col gap-4">
            {assigned.map((order) => (
              <AssignedOrderCard
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
        </section>
      ) : null}
    </div>
  )
}

function SectionHeading({
  children,
  count,
  accent = false,
}: {
  children: ReactNode
  count: number
  accent?: boolean
}) {
  return (
    <h2 className="flex items-center gap-2.5 text-[0.75rem] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
      {accent ? <span className="size-2 animate-pulse rounded-full bg-brand" /> : null}
      {children}
      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[0.6875rem] tracking-normal">
        {count}
      </span>
    </h2>
  )
}

function OrderHeader({
  order,
  vanLabel,
  children,
}: {
  order: DispatchOrder
  vanLabel?: string | null
  children?: ReactNode
}) {
  const t = useTranslations()
  const locale = useLocale()
  const pickup = order.stops.find((s) => s.stop_type === "pickup")
  const windowMs = pickup?.eta_at ? Date.parse(pickup.eta_at) : NaN

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[1.0625rem] font-semibold">
          {order.customer_name ?? t("dispatch.orders.unnamedCustomer")}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <span className="max-w-[14rem] truncate font-mono">{order.external_ref}</span>
          {order.scheduled_date ? <MetaChip>{order.scheduled_date}</MetaChip> : null}
          {Number.isFinite(windowMs) ? <MetaChip>{formatClock(windowMs, locale)}</MetaChip> : null}
          {vanLabel ? <MetaChip tone="brand">{vanLabel}</MetaChip> : null}
        </div>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

function MetaChip({ children, tone }: { children: ReactNode; tone?: "brand" }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono ${
        tone === "brand" ? "bg-brand/12 font-semibold text-brand-strong" : "bg-muted"
      }`}
    >
      {children}
    </span>
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

function StopIdentity({ stop }: { stop: DispatchStop }) {
  const t = useTranslations()
  const Icon = STOP_TYPE_ICON[stop.stop_type]
  return (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand-strong">
        <Icon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[0.875rem] font-semibold">{t(STOP_TYPE_KEY[stop.stop_type])}</div>
        <div className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
          {stop.address ?? `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}`}
        </div>
      </div>
    </>
  )
}

/**
 * An order the ingest seam delivered without a van (or one thrown back via
 * "unassign"). One decision, one control: pick a van, assign — every vanless
 * stop is patched onto it in intra-order visit order.
 */
function UnassignedOrderCard({
  order,
  vehicles,
  nextSeqFor,
  accessToken,
  onChanged,
}: {
  order: DispatchOrder
  vehicles: DispatchVehicle[]
  nextSeqFor: (vehicleId: string) => number
  accessToken: string
  onChanged: () => void
}) {
  const t = useTranslations()
  const { busy, error, run } = useAsyncAction(onChanged)
  const [vehicleId, setVehicleId] = useState("")

  const onAssign = () => {
    if (!vehicleId) return
    const stopIds = order.stops.filter((s) => s.vehicle_id == null).map((s) => s.id)
    void run(() =>
      assignOrder({ accessToken, stopIds, vehicleId, baseSeq: nextSeqFor(vehicleId) })
    )
  }

  const onCancel = () => {
    void run(() => cancelOrder({ accessToken, source: order.source, externalRef: order.external_ref }))
  }

  return (
    <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-card)] ring-2 ring-brand/25">
      <OrderHeader order={order}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/12 px-2.5 py-1 text-[0.75rem] font-semibold text-brand-strong">
          <span className="size-1.5 rounded-full bg-brand" />
          {t("dispatch.orders.unassignedChip")}
        </span>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t("dispatch.orders.cancelOrder")}
        </Button>
      </OrderHeader>

      <div className="mt-4 flex flex-col divide-y divide-border/60">
        {order.stops.map((stop) => (
          <div key={stop.id} className="flex items-center gap-3 py-2.5">
            <StopIdentity stop={stop} />
            <StatusPill status={stop.status} />
          </div>
        ))}
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <NativeSelect
          className="min-w-[12rem]"
          value={vehicleId}
          disabled={busy || vehicles.length === 0}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          <NativeSelectOption value="">
            {vehicles.length === 0 ? t("dispatch.form.noVans") : t("dispatch.orders.chooseVan")}
          </NativeSelectOption>
          {vehicles.map((v) => (
            <NativeSelectOption key={v.id} value={v.id}>
              {v.label ?? v.id.slice(0, 8)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="button" disabled={busy || !vehicleId} onClick={onAssign}>
          {busy ? <Spinner className="size-4" /> : t("dispatch.orders.assign")}
        </Button>
      </div>
    </div>
  )
}

function AssignedOrderCard({
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
  const vanId = order.stops.find((s) => s.vehicle_id != null)?.vehicle_id ?? null
  const vanLabel = vanId
    ? (vehicles.find((v) => v.id === vanId)?.label ?? vanId.slice(0, 8))
    : null

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
    <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-card)]">
      <OrderHeader order={order} vanLabel={vanLabel}>
        {!hasDropoff ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onAddReturn}>
            {busy ? <Spinner className="size-4" /> : t("dispatch.orders.addReturn")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          {t("dispatch.orders.cancelOrder")}
        </Button>
      </OrderHeader>

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      <div className="mt-4 flex flex-col divide-y divide-border/60">
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

  const onReassign = (value: string) => {
    if (value === "unassign") {
      void run(() => patchStop({ accessToken, stopId: stop.id, patch: { vehicle_id: null } }))
      return
    }
    void run(() =>
      patchStop({
        accessToken,
        stopId: stop.id,
        patch: { vehicle_id: value, seq: nextSeqFor(value) },
      })
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <StopIdentity stop={stop} />
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
          <NativeSelectOption value="unassign">
            {t("dispatch.orders.unassignOption")}
          </NativeSelectOption>
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
