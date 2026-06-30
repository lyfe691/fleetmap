"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useTranslations } from "@/lib/i18n"
import type { ConnectErrorKind } from "@/lib/dashboard-session"
import type { TranslationKey } from "@/lib/i18n/en"

// Client-only (WebGL) and pulls in three.js — load lazily so it never touches
// SSR and the form paints instantly.
const BlinkingSquares = dynamic(() => import("@/components/blinking-squares"), {
  ssr: false,
})

type Props = {
  /** Validate + connect with the given code (drives `submitting`/`errorKind`). */
  onConnect: (code: string) => void
  /** Last failure kind, translated and shown inline under the input. */
  errorKind: ConnectErrorKind | null
  /** A connect attempt is in flight. */
  submitting: boolean
  /** A saved code that failed transiently — offered as a one-tap retry. */
  savedCode: string | null
}

export function DashboardCodeScreen({
  onConnect,
  errorKind,
  submitting,
  savedCode,
}: Props) {
  const t = useTranslations()
  const [code, setCode] = useState("")
  const trimmed = code.trim()

  return (
    <div className="grid h-full w-full bg-background lg:grid-cols-2">
      {/* Left — the form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-xs">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            {t("gate.title")}
          </h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            {t("gate.description")}
          </p>

          <form
            className="mt-8 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (trimmed && !submitting) onConnect(trimmed)
            }}
          >
            <label htmlFor="display-code" className="sr-only">
              {t("gate.title")}
            </label>
            <Input
              id="display-code"
              type="password"
              autoComplete="off"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("gate.placeholder")}
              disabled={submitting}
              aria-invalid={errorKind != null}
              className="h-12 rounded-xl px-4 text-base"
            />

            {errorKind ? (
              <p className="px-1 text-sm text-destructive" role="alert">
                {t(("gate.error." + errorKind) as TranslationKey)}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={!trimmed || submitting}
              className="h-12 rounded-xl text-base font-medium"
            >
              {submitting ? (
                <>
                  <Spinner />
                  {t("gate.connecting")}
                </>
              ) : (
                t("gate.connect")
              )}
            </Button>

            {savedCode ? (
              <button
                type="button"
                onClick={() => onConnect(savedCode)}
                disabled={submitting}
                className="mt-1 text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
              >
                {t("gate.retrySaved")}
              </button>
            ) : null}
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
