"use client"

import type { Session } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderForm } from "@/components/dispatch/order-form"
import { OrdersList } from "@/components/dispatch/orders-list"
import { useTranslations } from "@/lib/i18n"
import { getDispatcherClient } from "@/lib/supabase/dispatcher"
import { useDispatchData } from "@/lib/dispatch/use-dispatch-data"

// Deliberately NOT h-screen/flex-1/min-h-0 — that chain depends on every
// ancestor resolving a definite height, and silently collapses (map "cut in
// half", fields "cut off") the moment one link breaks, e.g. below the `lg`
// grid breakpoint. min-h-screen + ordinary document flow always shows every
// field; the page just scrolls if content is taller than the viewport.
export function DispatchConsole({ session }: { session: Session }) {
  const t = useTranslations()
  const supabase = getDispatcherClient()
  const { vehicles, orders, loading, error, refresh, nextSeqFor } = useDispatchData(supabase)

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[64rem] flex-col px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">
            {t("dispatch.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
          {t("dispatch.signOut")}
        </Button>
      </div>

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="new" className="mt-6">
        <TabsList>
          <TabsTrigger value="new">{t("dispatch.tab.newOrder")}</TabsTrigger>
          <TabsTrigger value="orders">
            {t("dispatch.tab.orders", { n: orders.length })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-4">
          <OrderForm
            vehicles={vehicles}
            nextSeqFor={nextSeqFor}
            accessToken={session.access_token}
            onCreated={refresh}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-4 pb-6">
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
