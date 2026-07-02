"use client"

import { useState, type FormEvent } from "react"
import dynamic from "next/dynamic"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useTranslations } from "@/lib/i18n"
import { getDispatcherClient } from "@/lib/supabase/dispatcher"

// Same split-layout idea as the dashboard display-code screen: form on the
// left, the brand-teal animated field on the right (desktop only). Client-only
// (WebGL/three.js) so it loads lazily and never touches SSR.
const BlinkingSquares = dynamic(() => import("@/components/blinking-squares"), {
  ssr: false,
})

export function DispatchLogin() {
  const t = useTranslations()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error } = await getDispatcherClient().auth.signInWithPassword({
      email,
      password,
    })
    setSubmitting(false)
    if (error) setError(t("dispatch.login.error"))
  }

  return (
    <div className="grid min-h-screen w-full bg-background lg:grid-cols-2">
      {/* Left — the form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xs">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {t("dispatch.login.title")}
          </h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            {t("dispatch.login.subtitle")}
          </p>

          <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
            <Field>
              <FieldLabel htmlFor="dispatch-email">{t("dispatch.login.email")}</FieldLabel>
              <Input
                id="dispatch-email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="h-12 rounded-xl px-4 text-base"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="dispatch-password">{t("dispatch.login.password")}</FieldLabel>
              <Input
                id="dispatch-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                aria-invalid={error != null}
                className="h-12 rounded-xl px-4 text-base"
              />
            </Field>

            {error ? (
              <p className="px-1 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={submitting || !email || !password}
              className="h-12 rounded-xl text-base font-medium"
            >
              {submitting ? (
                <>
                  <Spinner />
                  {t("dispatch.login.submit")}
                </>
              ) : (
                t("dispatch.login.submit")
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Right — animated field over the page background (desktop only) */}
      <div className="relative hidden overflow-hidden lg:block" aria-hidden>
        <ErrorBoundary>
          <BlinkingSquares
            className="absolute inset-0"
            direction="right"
            gridSize={58}
            squareColor="#1bbecd"
            falloff={1.5}
            fadeStart={0.35}
            fadeEnd={1}
            squareSize={0.6}
            minBrightness={0.4}
            twinkleSpeed={1.1}
            twinkleStrength={0.8}
          />
        </ErrorBoundary>
      </div>
    </div>
  )
}
