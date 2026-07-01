"use client"

import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { Spinner } from "@/components/ui/spinner"
import { DispatchConsole } from "@/components/dispatch/dispatch-console"
import { DispatchLogin } from "@/components/dispatch/dispatch-login"
import { getDispatcherClient } from "@/lib/supabase/dispatcher"

// undefined = still resolving the persisted session; null = signed out.
export function DispatchGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    const supabase = getDispatcherClient()
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Spinner className="size-8" />
      </div>
    )
  }
  if (!session) return <DispatchLogin />
  return <DispatchConsole session={session} />
}
