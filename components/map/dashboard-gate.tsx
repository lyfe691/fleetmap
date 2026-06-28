"use client"

import { useEffect, useState } from "react"
import { ConsoleClient } from "@/components/console/console-client"
import { ConsoleLoading } from "@/components/console/console-loading"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  clearDisplayCode,
  getDisplayCode,
  setDisplayCode,
} from "@/lib/dashboard-code"
import { connectDashboard } from "@/lib/dashboard-session"

// resolving: reading the saved code (server + first hydration render).
// reconnecting: validating a saved code on load (full-screen loader).
// prompt: asking for a code — the only place a wrong code can be entered.
// connected: session established, console mounted.
type Phase = "resolving" | "reconnecting" | "prompt" | "connected"

export function DashboardGate() {
  const [phase, setPhase] = useState<Phase>("resolving")
  const [error, setError] = useState<string | null>(null)
  // The saved code is kept around only to offer a retry after a transient
  // failure (invalid codes are dropped, so this is null then).
  const [savedCode, setSavedCode] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const apply = (code: string, result: Awaited<ReturnType<typeof connectDashboard>>) => {
    if (result.ok) {
      setDisplayCode(code)
      setSavedCode(code)
      setError(null)
      setPhase("connected")
      return
    }
    // A wrong code is never kept; a transient failure keeps it for retry.
    if (result.kind === "invalid-code") {
      clearDisplayCode()
      setSavedCode(null)
    }
    setError(result.message)
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
    setError(null)
    const result = await connectDashboard(code)
    setSubmitting(false)
    apply(code, result)
  }

  const disconnect = () => {
    clearDisplayCode()
    setSavedCode(null)
    setInput("")
    setError(null)
    setPhase("prompt")
  }

  if (phase === "resolving" || phase === "reconnecting") return <ConsoleLoading />
  if (phase === "connected") return <ConsoleClient onChangeCode={disconnect} />

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Fleet dashboard</CardTitle>
          <CardDescription>Enter the display code to connect.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              const trimmed = input.trim()
              if (trimmed && !submitting) void connect(trimmed)
            }}
          >
            <Field>
              <FieldLabel htmlFor="display-code">Display code</FieldLabel>
              <Input
                id="display-code"
                type="password"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Display code"
                autoFocus
                disabled={submitting}
                aria-invalid={error != null}
              />
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </Field>
            <Button type="submit" disabled={!input.trim() || submitting}>
              {submitting ? "Connecting…" : "Connect"}
            </Button>
            {savedCode ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => void connect(savedCode)}
              >
                Retry saved code
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
