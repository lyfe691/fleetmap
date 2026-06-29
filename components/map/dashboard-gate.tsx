"use client"

import { useEffect, useState } from "react"
import { ConsoleClient } from "@/components/console/console-client"
import { ConsoleLoading } from "@/components/console/console-loading"
import { DashboardCodeScreen } from "@/components/map/dashboard-code-screen"
import {
  clearDisplayCode,
  getDisplayCode,
  setDisplayCode,
} from "@/lib/dashboard-code"
import { connectDashboard, type ConnectErrorKind } from "@/lib/dashboard-session"

// resolving: reading the saved code (server + first hydration render).
// reconnecting: validating a saved code on load (full-screen loader).
// prompt: asking for a code — the only place a wrong code can be entered.
// connected: session established, console mounted.
type Phase = "resolving" | "reconnecting" | "prompt" | "connected"

export function DashboardGate() {
  const [phase, setPhase] = useState<Phase>("resolving")
  const [errorKind, setErrorKind] = useState<ConnectErrorKind | null>(null)
  // Kept around only to offer a retry after a transient failure (invalid codes
  // are dropped, so this is null then).
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const apply = (code: string, result: Awaited<ReturnType<typeof connectDashboard>>) => {
    if (result.ok) {
      setDisplayCode(code)
      setSavedCode(code)
      setErrorKind(null)
      setPhase("connected")
      return
    }
    // A wrong code is never kept; a transient failure keeps it for retry.
    if (result.kind === "incorrect") {
      clearDisplayCode()
      setSavedCode(null)
    }
    setErrorKind(result.kind)
    setPhase("prompt")
  }

  // Auto-connect a saved code on load so the kiosk reconnects unattended.
  useEffect(() => {
    const saved = getDisplayCode()
    if (!saved) {
      setPhase("prompt")
      return
    }
    setSavedCode(saved)
    setPhase("reconnecting")
    let cancelled = false
    void connectDashboard(saved).then((result) => {
      if (!cancelled) apply(saved, result)
    })
    return () => {
      cancelled = true
    }
    // Runs once on mount; `apply` only calls stable setState functions.
  }, [])

  const connect = async (code: string) => {
    setSubmitting(true)
    setErrorKind(null)
    const result = await connectDashboard(code)
    setSubmitting(false)
    apply(code, result)
  }

  const disconnect = () => {
    clearDisplayCode()
    setSavedCode(null)
    setErrorKind(null)
    setPhase("prompt")
  }

  if (phase === "resolving" || phase === "reconnecting") return <ConsoleLoading />
  if (phase === "connected") return <ConsoleClient onChangeCode={disconnect} />

  return (
    <DashboardCodeScreen
      onConnect={connect}
      errorKind={errorKind}
      submitting={submitting}
      savedCode={savedCode}
    />
  )
}
