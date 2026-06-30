"use client"

import { ArrowRight, Check, Clock } from "lucide-react"
import { assumedHistory, type AssumedTrip } from "@/lib/console/assumed"
import { PlaceholderNote } from "@/components/console/placeholder-note"
import { useTranslations } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"

const STATUS_KEY: Record<AssumedTrip["status"], TranslationKey> = {
  Delivered: "history.status.delivered",
  Delayed: "history.status.delayed",
}

export function HistoryView() {
  const t = useTranslations()
  const trips = assumedHistory()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-8 pt-7 pb-12">
        <h2 className="font-heading text-[28px] font-semibold tracking-tight">
          {t("history.title")}
        </h2>
        <p className="mt-1.5 text-[15px] text-muted-foreground">
          {t("history.subtitle")}
        </p>
        <PlaceholderNote className="mt-1" textKey="placeholder.orders" />

        <div className="mt-6 flex flex-col gap-3">
          {trips.map((trip) => (
            <TripRow key={trip.id} trip={trip} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TripRow({ trip }: { trip: AssumedTrip }) {
  const t = useTranslations()
  const delivered = trip.status === "Delivered"
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card px-6 py-5 shadow-md">
      <div
        className={`flex size-12 shrink-0 items-center justify-center rounded-[14px] ${
          delivered ? "bg-success/15 text-success" : "bg-warning/15 text-warning-strong"
        }`}
      >
        {delivered ? <Check className="size-6" /> : <Clock className="size-6" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[16px] font-semibold">{trip.reg}</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
              delivered ? "bg-success/15 text-success" : "bg-warning/15 text-warning-strong"
            }`}
          >
            {t(STATUS_KEY[trip.status])}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[15px] text-muted-foreground">
          <span className="truncate">{trip.origin}</span>
          <ArrowRight className="size-[18px] shrink-0" />
          <span className="truncate font-medium text-foreground">{trip.dest}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-[15px] font-semibold">
          {t(trip.day)} · {trip.time}
        </div>
        <div className="mt-1 text-[13px] text-muted-foreground">
          {trip.duration} · {trip.distance}
        </div>
      </div>
    </div>
  )
}
