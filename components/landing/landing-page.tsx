"use client"

import Link from "next/link"
import { ArrowRight, Monitor } from "lucide-react"
import { BubbleboxLogo } from "@/components/console/bubblebox-logo"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { useTranslations } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { cn } from "@/lib/utils"

type Entry = {
  href: string
  icon: typeof Monitor
  titleKey: TranslationKey
  descKey: TranslationKey
  live?: boolean
}

const ENTRIES: Entry[] = [
  {
    href: "/dashboard",
    icon: Monitor,
    titleKey: "landing.dashboard.title",
    descKey: "landing.dashboard.desc",
    live: true,
  },
]

export function LandingPage() {
  const t = useTranslations()

  return (
    <main className="relative flex min-h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Soft brand wash only — no grid, no dashed art-route. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 50% at 50% 0%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 65%)",
        }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-6 py-14 sm:px-10">
        <header className="flex flex-col items-center text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-brand/12 ring-1 ring-brand/20">
            <BubbleboxLogo className="size-8 text-foreground" />
          </span>
          <h1 className="mt-5 font-heading text-[2.25rem] leading-none font-semibold tracking-tight sm:text-[2.75rem]">
            Fleetmap
          </h1>
          <p className="mt-3 max-w-md text-[1rem] text-muted-foreground sm:text-[1.0625rem]">
            {t("landing.tagline")}
          </p>
        </header>

        {/* Map language: traveled grey · remaining brand · stop dots · top-down van. */}
        <RouteVignette className="mx-auto mt-10 w-full max-w-xl sm:mt-12" />

        <div className="mx-auto mt-10 w-full max-w-md sm:mt-12">
          {ENTRIES.map((entry) => (
            <LandingCard key={entry.href} entry={entry} />
          ))}
        </div>
      </div>

      <footer className="relative z-10 px-6 pb-8 text-center text-[0.8125rem] text-muted-foreground">
        Bubble Box
      </footer>
    </main>
  )
}

/**
 * Decorative day-route in the console map's language:
 * traveled grey · remaining brand · waypoint dots · top-down van.
 *
 * Asset (`bubblebox-van-top.png`) points **north at 0°**. CSS rotate is
 * clockwise and matches compass bearing — same as VehicleMarker. This line
 * runs west→east, so the van faces east (heading 90).
 *
 * Position and rotation stay separate: a centered wrapper for placement,
 * rotate only on the <img> (combining translate+rotate on one transform
 * was misplacing the marker).
 */
function RouteVignette({ className }: { className?: string }) {
  // Fraction along the rail (0..1). Split traveled / remaining at the van.
  const vanAt = 0.4
  // Asset points north at 0°; road runs west→east → face east.
  const headingDeg = 90

  const stops: { at: number; state: "done" | "next" | "upcoming" }[] = [
    { at: 0.0, state: "done" },
    { at: 0.18, state: "done" },
    { at: 0.55, state: "next" },
    { at: 0.75, state: "upcoming" },
    { at: 1.0, state: "upcoming" },
  ]

  return (
    <div
      aria-hidden
      className={cn("relative h-16 w-full sm:h-[4.5rem]", className)}
    >
      {/* Single rail: two segments meeting under the van's center. */}
      <div className="absolute top-1/2 right-[5%] left-[5%] flex h-[3px] -translate-y-1/2">
        <div
          className="h-full rounded-full bg-muted-foreground/35"
          style={{ width: `${vanAt * 100}%` }}
        />
        <div className="h-full flex-1 rounded-full bg-brand" />
      </div>

      {stops.map((s) => (
        <VignetteStop key={s.at} at={s.at} state={s.state} />
      ))}

      {/* Placement shell only — rotate lives on the img (map pattern). */}
      <div
        className="absolute top-1/2 z-10 size-11 -translate-x-1/2 -translate-y-1/2 sm:size-12"
        style={{ left: railLeft(vanAt) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bubblebox-van-top.png"
          alt=""
          width={48}
          height={48}
          draggable={false}
          className="size-full select-none"
          style={{
            transform: `rotate(${headingDeg}deg)`,
            filter: "drop-shadow(0 2px 4px rgb(0 0 0 / 0.3))",
          }}
        />
      </div>
    </div>
  )
}

/** Map 0..1 fractions onto the same 5%–95% rail the line uses. */
function railLeft(at: number): string {
  return `calc(5% + ${at * 90}%)`
}

function VignetteStop({
  at,
  state,
}: {
  at: number
  state: "done" | "next" | "upcoming"
}) {
  // Sizes match fleet StopDot proportions (emphasized next ≈ 5+2.5 radius).
  const r = state === "next" ? 5 : 3.5
  const stroke = state === "next" ? 2.5 : 2
  const size = (r + stroke) * 2
  const fill =
    state === "done"
      ? "color-mix(in srgb, var(--muted-foreground) 25%, var(--surface))"
      : "var(--surface)"
  const ring =
    state === "done"
      ? "color-mix(in srgb, var(--muted-foreground) 50%, transparent)"
      : "var(--brand)"

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
      className="absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2"
      style={{ left: railLeft(at) }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill={fill}
        stroke={ring}
        strokeWidth={stroke}
      />
    </svg>
  )
}

function LandingCard({ entry }: { entry: Entry }) {
  const t = useTranslations()
  const Icon = entry.icon

  // Tap scale mirrors fleet-rail VehicleCard: Tailwind v4 treats `scale` as its
  // own property — transition-[scale] + active:scale, not transform.
  return (
    <Link
      href={entry.href}
      className="block transition-[scale] duration-200 ease-out active:scale-[0.97]"
    >
      <Card className="h-full cursor-pointer gap-0">
        <CardContent className="flex min-h-[11.5rem] flex-col sm:min-h-[13.5rem]">
          <div className="flex items-start justify-between gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/12 text-brand-strong">
              <Icon className="size-6" strokeWidth={1.75} />
            </span>
            {entry.live ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/12 px-2.5 py-1 text-[0.75rem] font-semibold text-success">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                </span>
                {t("landing.live")}
              </span>
            ) : null}
          </div>

          <div className="mt-5 flex flex-1 flex-col">
            <h2 className="font-heading text-[1.375rem] font-semibold tracking-tight sm:text-[1.5rem]">
              {t(entry.titleKey)}
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">
              {t(entry.descKey)}
            </p>
            <span className="mt-auto flex items-center gap-1.5 pt-6 text-[0.9375rem] font-semibold text-brand-strong">
              {t("landing.open")}
              <ArrowRight className="size-4" />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
