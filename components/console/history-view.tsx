"use client"

import { ArrowRight, Check, Clock } from "lucide-react"
import { assumedHistory, type AssumedTrip } from "@/lib/console/assumed"

export function HistoryView() {
  const trips = assumedHistory()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-[30px] pt-6 pb-11">
        <h2 className="font-heading text-[23px] font-semibold tracking-tight">
          Trip History
        </h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Completed deliveries, most recent first
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Placeholder data — pending the orders/deliveries model.
        </p>

        <div className="mt-5 flex flex-col gap-3">
          {trips.map((t) => (
            <TripRow key={t.id} trip={t} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TripRow({ trip }: { trip: AssumedTrip }) {
  const delivered = trip.status === "Delivered"
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-md">
      <div
        className={`flex size-11 shrink-0 items-center justify-center rounded-[13px] ${
          delivered ? "bg-success/15 text-success" : "bg-warning/15 text-warning-strong"
        }`}
      >
        {delivered ? <Check className="size-5" /> : <Clock className="size-5" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-semibold">{trip.reg}</span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
              delivered ? "bg-success/15 text-success" : "bg-warning/15 text-warning-strong"
            }`}
          >
            {trip.status}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="truncate">{trip.origin}</span>
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="truncate font-medium text-foreground">{trip.dest}</span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="font-mono text-[13.5px] font-semibold">{trip.date}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {trip.duration} · {trip.distance}
        </div>
      </div>
    </div>
  )
}
