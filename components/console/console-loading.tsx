"use client"

import { BubbleboxLogo } from "@/components/console/bubblebox-logo"
import { useTranslations } from "@/lib/i18n"

export function ConsoleLoading() {
  const t = useTranslations()
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-6 bg-background">
      <div className="relative flex size-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-muted border-t-foreground/50" />
        <BubbleboxLogo className="size-10 text-foreground" />
      </div>
      <div className="text-center">
        <div className="font-heading text-2xl font-semibold tracking-tight">
          Fleetmap
        </div>
        <div className="mt-1.5 text-[15px] text-muted-foreground">
          {t("loading.subtitle")}
        </div>
      </div>
    </div>
  )
}
