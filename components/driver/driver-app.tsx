"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { Session } from "@supabase/supabase-js"
import { Button } from "@/components/ui/button"
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
        <p className="text-neutral-400">Loading…</p>
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
      <form
        className="flex w-full max-w-xs flex-col gap-3"
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
        <h1 className="text-xl font-semibold">Driver sign in</h1>
        <input
          type="email"
          placeholder="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2 text-black"
        />
        <input
          type="password"
          placeholder="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2 text-black"
        />
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
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
          <p className="text-sm text-neutral-400">{email}</p>
          <h1 className="text-2xl font-semibold">
            {active ? "Tracking" : "Not tracking"}
          </h1>
        </div>

        <button
          type="button"
          onClick={toggle}
          className={`flex h-40 w-40 items-center justify-center rounded-full text-2xl font-bold text-white ${
            active ? "bg-green-600" : "bg-neutral-700"
          }`}
        >
          {active ? "ON" : "OFF"}
        </button>

        {blocked ? (
          <p className="rounded bg-red-600 px-3 py-2 text-center text-sm text-white">
            {blocked}
          </p>
        ) : null}

        <dl className="w-full space-y-1 text-sm text-neutral-300">
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
    <div className="flex justify-between border-b border-neutral-800 py-1">
      <dt>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  )
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen w-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-6 text-white">
      {children}
    </main>
  )
}
