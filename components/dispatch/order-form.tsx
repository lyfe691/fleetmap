"use client"

import { useMemo, useState, type FormEvent } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { PinMap } from "@/components/dispatch/pin-map"
import { useTranslations } from "@/lib/i18n"
import { createOrder } from "@/lib/dispatch/actions"
import type { DispatchVehicle } from "@/lib/dispatch/use-dispatch-data"

export function OrderForm({
  vehicles,
  nextSeqFor,
  accessToken,
  onCreated,
}: {
  vehicles: DispatchVehicle[]
  nextSeqFor: (vehicleId: string) => number
  accessToken: string
  onCreated: () => void
}) {
  const t = useTranslations()
  const [customerName, setCustomerName] = useState("")
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? "")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [address, setAddress] = useState("")
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // The 30-minute booking window Bubble Box already captures on their site —
  // stored as stops.eta_at (an "optional planned window" by design, not
  // something we compute). Date-only orders (no time picked) skip it.
  const etaAt = useMemo(() => {
    if (!date || !time) return null
    const parsed = new Date(`${date}T${time}:00`)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }, [date, time])

  const canSubmit = pin != null && vehicleId !== "" && !submitting

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pin || !vehicleId) return
    setSubmitting(true)
    setError(null)
    setSuccess(false)
    const result = await createOrder({
      accessToken,
      customerName: customerName.trim() || null,
      scheduledDate: date || null,
      vehicleId,
      lat: pin.lat,
      lng: pin.lng,
      address: address.trim() || null,
      etaAt,
      seq: nextSeqFor(vehicleId),
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSuccess(true)
    setCustomerName("")
    setAddress("")
    setPin(null)
    setDate("")
    setTime("")
    onCreated()
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="order-customer">{t("dispatch.form.customerName")}</FieldLabel>
          <Input
            id="order-customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={t("dispatch.form.customerNamePlaceholder")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="order-address">{t("dispatch.form.addressLabel")}</FieldLabel>
          <Input
            id="order-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("dispatch.form.addressPlaceholder")}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="order-van">{t("dispatch.form.van")}</FieldLabel>
          <NativeSelect
            id="order-van"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            disabled={vehicles.length === 0}
          >
            {vehicles.length === 0 ? (
              <NativeSelectOption value="">{t("dispatch.form.noVans")}</NativeSelectOption>
            ) : null}
            {vehicles.map((v) => (
              <NativeSelectOption key={v.id} value={v.id}>
                {v.label ?? v.id.slice(0, 8)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="order-date">{t("dispatch.form.date")}</FieldLabel>
            <Input
              id="order-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="order-time">{t("dispatch.form.windowStart")}</FieldLabel>
            <Input
              id="order-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>

        <p className="text-sm text-muted-foreground">
          {t("dispatch.form.mapHint")}{" "}
          {pin
            ? t("dispatch.form.locationSet", { lat: pin.lat.toFixed(5), lng: pin.lng.toFixed(5) })
            : t("dispatch.form.noLocation")}
        </p>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertDescription>{t("dispatch.form.success")}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" disabled={!canSubmit}>
          {submitting ? <Spinner className="size-4" /> : t("dispatch.form.submit")}
        </Button>
      </div>

      <PinMap
        lat={pin?.lat ?? null}
        lng={pin?.lng ?? null}
        onPick={(lat, lng) => setPin({ lat, lng })}
      />
    </form>
  )
}
