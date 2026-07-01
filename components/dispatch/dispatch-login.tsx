"use client"

import { useState, type FormEvent } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useTranslations } from "@/lib/i18n"
import { getDispatcherClient } from "@/lib/supabase/dispatcher"

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
    <div className="flex min-h-screen w-screen items-center justify-center bg-background px-4 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-card)]"
      >
        <h1 className="font-heading text-xl font-semibold tracking-tight">
          {t("dispatch.login.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dispatch.login.subtitle")}
        </p>

        <div className="mt-6 flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="dispatch-email">{t("dispatch.login.email")}</FieldLabel>
            <Input
              id="dispatch-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
            />
          </Field>
        </div>

        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" disabled={submitting} className="mt-6 w-full">
          {submitting ? <Spinner className="size-4" /> : t("dispatch.login.submit")}
        </Button>
      </form>
    </div>
  )
}
