"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ConsoleClient } from "@/components/console/console-client"
import { ConsoleLoading } from "@/components/console/console-loading"
import { DashboardCodeScreen } from "@/components/map/dashboard-code-screen"
import { getBrowserClient } from "@/lib/supabase/browser"
import {
  clearDisplayCode,
  getDisplayCode,
  setDisplayCode,
} from "@/lib/dashboard-code"
import { connectDashboard, type ConnectErrorKind } from "@/lib/dashboard-session"

// resolving: reading the saved code (server + first hydration render).
// reconnecting: validating/retrying a saved code (full-screen loader).
// prompt: asking for a code — the only place a wrong code can be entered.
// connected: session established, console mounted.
type Phase = "resolving" | "reconnecting" | "prompt" | "connected"

// Unattended reconnect backoff: a network/backend blip must not strand the TV
// on the prompt, so a transient failure retries until it recovers.
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30000

export function DashboardGate() {
  const [phase, setPhase] = useState<Phase>("resolving")
  const [errorKind, setErrorKind] = useState<ConnectErrorKind | null>(null)
  // Kept around only to offer a retry after a transient failure (invalid codes
  // are dropped, so this is null then).
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Bumping this cancels any in-flight reconnect loop (unmount, manual connect,
  // or disconnect), so at most one loop runs at a time.
  const genRef = useRef(0)

  // Auto-reconnect with backoff, for load and for mid-run self-heal. A rotated
  // code (403) drops to the prompt; a transient failure backs off and retries.
  const reconnect = useCallback(async (code: string) => {
    const gen = ++genRef.current
    setSavedCode(code)
    setErrorKind(null)
    setPhase("reconnecting")
    let delay = RETRY_BASE_MS
    while (genRef.current === gen) {
      const result = await connectDashboard(code)
      if (genRef.current !== gen) return
      if (result.ok) {
        setDisplayCode(code)
        setPhase("connected")
        return
      }
      if (result.kind === "incorrect") {
        clearDisplayCode()
        setSavedCode(null)
        setErrorKind("incorrect")
        setPhase("prompt")
        return
      }
      await sleep(delay)
      delay = Math.min(delay * 2, RETRY_MAX_MS)
    }
  }, [])

  // Manual entry: a human is watching, so one attempt and surface the result.
  const connect = useCallback(async (code: string) => {
    genRef.current++
    setSubmitting(true)
    setErrorKind(null)
    const result = await connectDashboard(code)
    setSubmitting(false)
    if (result.ok) {
      setDisplayCode(code)
      setSavedCode(code)
      setPhase("connected")
      return
    }
    if (result.kind === "incorrect") {
      clearDisplayCode()
      setSavedCode(null)
    }
    setErrorKind(result.kind)
    setPhase("prompt")
  }, [])

  const disconnect = useCallback(() => {
    genRef.current++
    clearDisplayCode()
    setSavedCode(null)
    setErrorKind(null)
    setPhase("prompt")
  }, [])

  // Auto-connect a saved code on load so the kiosk reconnects unattended.
  useEffect(() => {
    const saved = getDisplayCode()
    if (!saved) {
      setPhase("prompt")
      return
    }
    void reconnect(saved)
    return () => {
      genRef.current++
    }
  }, [reconnect])

  // Mid-run self-heal: a dying session (refresh token expired/revoked) fires
  // SIGNED_OUT. Re-mint from the stored code and remount the console instead of
  // stranding the TV; only a rotated code falls back to the prompt.
  useEffect(() => {
    if (phase !== "connected") return
    const supabase = getBrowserClient()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT") return
      const saved = getDisplayCode()
      if (saved) void reconnect(saved)
      else disconnect()
    })
    return () => data.subscription.unsubscribe()
  }, [phase, reconnect, disconnect])

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
