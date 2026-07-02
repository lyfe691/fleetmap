"use client"

import Link from "next/link"
import { ClipboardList, Monitor } from "lucide-react"
import { BubbleboxLogo } from "@/components/console/bubblebox-logo"
import { useTranslations } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"

type Entry = {
  href: string
  icon: typeof Monitor
  titleKey: TranslationKey
  descKey: TranslationKey
}

const ENTRIES: Entry[] = [
  { href: "/dashboard", icon: Monitor, titleKey: "landing.dashboard.title", descKey: "landing.dashboard.desc" },
  { href: "/dispatch", icon: ClipboardList, titleKey: "landing.dispatch.title", descKey: "landing.dispatch.desc" },
]

export function LandingPage() {
  const t = useTranslations()

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/12">
            <BubbleboxLogo className="size-7 text-foreground" />
          </span>
          <div className="leading-none">
            <div className="font-heading text-2xl font-semibold tracking-tight">Fleetmap</div>
            <div className="mt-1.5 text-[0.8125rem] text-muted-foreground">
              {t("landing.tagline")}
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3">
          {ENTRIES.map((entry) => (
            <LandingCard key={entry.href} entry={entry} />
          ))}
        </div>
      </div>
    </main>
  )
}

function LandingCard({ entry }: { entry: Entry }) {
  const t = useTranslations()
  const Icon = entry.icon
  return (
    <Link
      href={entry.href}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-brand/45 hover:bg-brand/[0.04]"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand-strong">
        <Icon className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-heading text-[1.0625rem] font-semibold tracking-tight">
          {t(entry.titleKey)}
        </div>
        <div className="mt-0.5 text-[0.875rem] text-muted-foreground">{t(entry.descKey)}</div>
      </div>
    </Link>
  )
}
