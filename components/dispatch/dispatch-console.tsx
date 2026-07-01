"use client"

import type { Session } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrderForm } from "@/components/dispatch/order-form"
import { OrdersList } from "@/components/dispatch/orders-list"
import { getDispatcherClient } from "@/lib/supabase/dispatcher"
import { useDispatchData } from "@/lib/dispatch/use-dispatch-data"

export function DispatchConsole({ session }: { session: Session }) {
  const supabase = getDispatcherClient()
  const { vehicles, orders, loading, error, refresh, nextSeqFor } = useDispatchData(supabase)

  return (
    <div className="mx-auto flex h-screen w-full max-w-[64rem] flex-col px-6 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-tight">Dispatch</h1>
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </div>

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="new" className="mt-6 flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="new">New order</TabsTrigger>
          <TabsTrigger value="orders">Orders ({orders.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-4 min-h-0 flex-1">
          <OrderForm
            vehicles={vehicles}
            nextSeqFor={nextSeqFor}
            accessToken={session.access_token}
            onCreated={refresh}
          />
        </TabsContent>

        <TabsContent value="orders" className="mt-4 min-h-0 flex-1 overflow-y-auto">
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
