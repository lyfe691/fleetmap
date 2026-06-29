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

type Category = "appearance" | "accessibility" | "language"

const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
  { id: "language", label: "Language", icon: Languages },
]

const SECTION_TITLE: Record<Category, string> = {
  appearance: "Appearance",
  accessibility: "Accessibility",
  language: "Language",
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [category, setCategory] = useState<Category>("appearance")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogDescription className="sr-only">
          Manage appearance, accessibility, and language preferences.
        </DialogDescription>

        <div className="flex min-h-[440px]">
          <nav
            aria-label="Settings categories"
            className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-border bg-surface p-3"
          >
            <DialogTitle className="px-3 pt-2 pb-3 text-[18px] font-semibold tracking-tight">
              Settings
            </DialogTitle>
            {CATEGORIES.map((entry) => {
              const Icon = entry.icon
              const active = entry.id === category
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={active ? "true" : undefined}
                  onClick={() => setCategory(entry.id)}
                  className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="truncate">{entry.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-6">
            <h2 className="mb-1 font-heading text-[20px] font-semibold tracking-tight">
              {SECTION_TITLE[category]}
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
