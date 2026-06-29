"use client"

import type { ReactNode } from "react"
import type { TranslationKey } from "@/lib/i18n/en"
import { useTranslations } from "@/lib/i18n"

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
    <p className={`text-[13px] text-muted-foreground/70 ${className ?? ""}`}>
      {textKey != null ? t(textKey) : children}
    </p>
  )
}
