"use client"

import { useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PillTabs } from "@/components/ui/pill-tabs"
import { BubbleboxLogo } from "@/components/console/bubblebox-logo"
import { OrderForm } from "@/components/dispatch/order-form"
import { OrdersList } from "@/components/dispatch/orders-list"
import { useTranslations } from "@/lib/i18n"
import { getDispatcherClient } from "@/lib/supabase/dispatcher"
import { isInProgress, isUnassigned, useDispatchData } from "@/lib/dispatch/use-dispatch-data"

// Deliberately NOT h-screen/flex-1/min-h-0 — that chain depends on every
// ancestor resolving a definite height, and silently collapses (map "cut in
// half", fields "cut off") the moment one link breaks, e.g. below the `lg`
// grid breakpoint. min-h-screen + ordinary document flow always shows every
// field; the page just scrolls if content is taller than the viewport.
export function DispatchConsole({ session }: { session: Session }) {
  const t = useTranslations()
  const supabase = getDispatcherClient()
  const { vehicles, orders, loading, error, refresh, nextSeqFor } = useDispatchData(supabase)
  // Both panels stay mounted (toggled with `hidden`) so the in-progress order
  // form keeps its state and the map isn't re-initialised on every tab switch.
  const [tab, setTab] = useState<"new" | "orders">("orders")

  const unassignedCount = orders.filter(isUnassigned).length
  const inProgressCount = orders.filter(isInProgress).length

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[68rem] flex-col px-6 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-brand/12">
            <BubbleboxLogo className="size-6 text-foreground" />
          </span>
          <div className="leading-none">
            <h1 className="font-heading text-[1.25rem] font-semibold tracking-tight">
              {t("dispatch.title")}
            </h1>
            <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{t("dispatch.subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden font-mono text-[0.8125rem] text-muted-foreground sm:inline">
            {session.user.email}
          </span>
          <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
            {t("dispatch.signOut")}
          </Button>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-3 gap-3 sm:max-w-xl">
        <StatTile
          value={loading ? "–" : unassignedCount}
          label={t("dispatch.stats.unassigned")}
          attention={!loading && unassignedCount > 0}
        />
        <StatTile value={loading ? "–" : inProgressCount} label={t("dispatch.stats.inProgress")} />
        <StatTile value={vehicles.length} label={t("dispatch.stats.vans")} />
      </div>

      <div className="mt-6">
        <PillTabs
          className="w-full max-w-sm"
          activeId={tab}
          onTabChange={(id) => setTab(id as "new" | "orders")}
          tabs={[
            {
              id: "orders",
              label: t("dispatch.tab.orders", { n: orders.length }),
              ariaLabel: t("dispatch.tab.orders", { n: orders.length }),
            },
            { id: "new", label: t("dispatch.tab.newOrder"), ariaLabel: t("dispatch.tab.newOrder") },
          ]}
        />
      </div>

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <div className={tab === "new" ? "mt-6" : "hidden"}>
        <OrderForm
          vehicles={vehicles}
          nextSeqFor={nextSeqFor}
          accessToken={session.access_token}
          onCreated={refresh}
        />
      </div>

      <div className={tab === "orders" ? "mt-6" : "hidden"}>
        {loading ? (
          <Spinner className="size-6" />
        ) : (
          <OrdersList
            orders={orders}
            vehicles={vehicles}
            nextSeqFor={nextSeqFor}
            accessToken={session.access_token}
            supabase={supabase}
            onChanged={refresh}
          />
        )}
      </div>
    </div>
  )
}

function StatTile({
  value,
  label,
  attention = false,
}: {
  value: ReactNode
  label: string
  attention?: boolean
}) {
  return (
    <div
      className={`rounded-2xl bg-card px-4 py-3.5 shadow-[var(--shadow-card)] ${
        attention ? "ring-2 ring-brand/30" : ""
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[1.5rem] leading-none font-semibold tracking-tight">
          {value}
        </span>
        {attention ? <span className="size-2 animate-pulse rounded-full bg-brand" /> : null}
      </div>
      <div className="mt-1.5 text-[0.75rem] text-muted-foreground">{label}</div>
    </div>
  )
}
