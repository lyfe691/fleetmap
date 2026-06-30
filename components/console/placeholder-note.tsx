"use client"

import type { ReactNode } from "react"
import { FlaskConical } from "lucide-react"
import type { TranslationKey } from "@/lib/i18n/en"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// Marks data that isn't from a real feed yet (assumed telematics/cargo/history).
// A dashed, icon-led chip reads as an explicit annotation rather than body copy,
// so a placeholder number is never mistaken for live data on the wall TV. Styled
// neutral on purpose — it must not borrow a status colour (those carry meaning).
export function PlaceholderNote({
  children,
  textKey,
  className,
}: {
  children?: ReactNode
  textKey?: TranslationKey
  className?: string
}) {
  const t = useTranslations()
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-2 py-1 text-[0.75rem] font-medium text-muted-foreground",
        className
      )}
    >
      <FlaskConical className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{textKey != null ? t(textKey) : children}</span>
    </span>
  )
}
