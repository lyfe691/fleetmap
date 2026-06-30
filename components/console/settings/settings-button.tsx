"use client"

import { Settings } from "lucide-react"
import { useTranslations } from "@/lib/i18n"

export function SettingsButton({
  onClick,
  collapsed,
}: {
  onClick: () => void
  collapsed?: boolean
}) {
  const t = useTranslations()

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={t("settings.title")}
        title={t("settings.title")}
        className="flex size-11 items-center justify-center rounded-xl border border-sidebar-border text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <Settings className="size-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("settings.title")}
      className="flex h-12 flex-1 items-center justify-center gap-2.5 rounded-2xl border border-sidebar-border text-[0.9375rem] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      <Settings className="size-5" />
      {t("settings.title")}
    </button>
  )
}
