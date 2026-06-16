"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { getDriverClient } from "@/lib/supabase/driver"
import { useGeolocation } from "@/lib/use-geolocation"
import { useLocationSync } from "@/lib/use-location-sync"
import { useWakeLock } from "@/lib/use-wake-lock"

export function DriverApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    const supabase = getDriverClient()
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <Screen>
        <Spinner className="size-6 text-muted-foreground" />
      </Screen>
    )
  }
  if (!session) return <LoginForm />
  return <Tracker email={session.user.email ?? "driver"} />
}

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Screen>
      <Card className="w-full max-w-xs">
        <CardHeader>
          <CardTitle className="text-lg">Driver sign in</CardTitle>
          <CardDescription>
            Sign in to start sharing your location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              setError(null)
              const { error } = await getDriverClient().auth.signInWithPassword({
                email,
                password,
              })
              setBusy(false)
              if (error) setError(error.message)
            }}
          >
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </Screen>
  )
}

function Tracker({ email }: { email: string }) {
  const [active, setActive] = useState(false)
  const wakeLock = useWakeLock()
  const sync = useLocationSync(active)
  const geo = useGeolocation(active, sync.onFix)

  const blocked = !geo.supported
    ? "This device has no geolocation."
    : geo.error === "denied"
      ? "Location permission denied — enable location for this site."
      : sync.error === "no-vehicle"
        ? "No vehicle is assigned to this account."
        : sync.error === "auth"
          ? "Session expired — sign out and back in."
          : null

  const toggle = () => {
    if (active) {
      setActive(false)
      void wakeLock.disable()
    } else {
      // Acquire the wake lock synchronously in the click (user-gesture rule).
      wakeLock.enable()
      setActive(true)
    }
  }

  return (
    <Screen>
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{email}</p>
          <h1 className="text-2xl font-semibold">
            {active ? "Tracking" : "Not tracking"}
          </h1>
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-pressed={active}
          className={cn(
            "flex h-40 w-40 items-center justify-center rounded-full text-2xl font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {active ? "ON" : "OFF"}
        </button>

        {blocked ? (
          <Alert variant="destructive">
            <AlertDescription>{blocked}</AlertDescription>
          </Alert>
        ) : null}

        <dl className="w-full space-y-1 text-sm text-muted-foreground">
          <Row label="Network" value={sync.online ? "online" : "offline"} />
          <Row
            label="Screen lock"
            value={
              !wakeLock.supported
                ? "unsupported"
                : wakeLock.active
                  ? "held"
                  : active
                    ? "not held"
                    : "off"
            }
          />
          <Row label="Queued" value={String(sync.queued)} />
          <Row
            label="Last sent"
            value={
              sync.lastSentAt
                ? new Date(sync.lastSentAt).toLocaleTimeString()
                : "—"
            }
          />
        </dl>

        <Button
          variant="outline"
          onClick={async () => {
            setActive(false)
            await wakeLock.disable()
            await getDriverClient().auth.signOut()
          }}
        >
          Sign out
        </Button>
      </div>
    </Screen>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border py-1">
      <dt>{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  )
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh w-full flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
      {children}
    </main>
  )
}
