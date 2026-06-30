"use client"

import { useState } from "react"
import { Accessibility, Languages, Palette, type LucideIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppearanceSection } from "@/components/console/settings/appearance-section"
import { AccessibilitySection } from "@/components/console/settings/accessibility-section"
import { LanguageSection } from "@/components/console/settings/language-section"
import { useTranslations } from "@/lib/i18n/index"
import type { TranslationKey } from "@/lib/i18n/en"

type Category = "appearance" | "accessibility" | "language"

const CATEGORY_DEFS: { id: Category; key: TranslationKey; icon: LucideIcon }[] = [
  { id: "appearance", key: "settings.cat.appearance", icon: Palette },
  { id: "accessibility", key: "settings.cat.accessibility", icon: Accessibility },
  { id: "language", key: "settings.cat.language", icon: Languages },
]

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [category, setCategory] = useState<Category>("appearance")
  const t = useTranslations()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("settings.description")}
        </DialogDescription>

        <div className="flex min-h-[27.5rem]">
          <nav
            aria-label={t("settings.categories")}
            className="flex w-[12.5rem] shrink-0 flex-col gap-1 border-r border-border bg-surface p-3"
          >
            <div className="px-3 pt-2 pb-3 text-[1.125rem] font-semibold tracking-tight">
              {t("settings.title")}
            </div>
            {CATEGORY_DEFS.map((entry) => {
              const Icon = entry.icon
              const active = entry.id === category
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setCategory(entry.id)}
                  className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium transition-colors ${
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="truncate">{t(entry.key)}</span>
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <h2 className="mb-1 font-heading text-[1.25rem] font-semibold tracking-tight">
              {t(CATEGORY_DEFS.find((c) => c.id === category)!.key)}
            </h2>
            <div className="mt-3">
              {category === "appearance" ? <AppearanceSection /> : null}
              {category === "accessibility" ? <AccessibilitySection /> : null}
              {category === "language" ? <LanguageSection /> : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
