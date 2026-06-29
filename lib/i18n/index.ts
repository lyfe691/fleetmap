"use client"

import { useSettings } from "@/lib/settings/settings-provider"
import type { Locale } from "@/lib/settings/types"
import { en, type TranslationKey } from "@/lib/i18n/en"
import { deCH } from "@/lib/i18n/de-CH"

const DICTS: Record<Locale, Record<TranslationKey, string>> = { en, "de-CH": deCH }

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  let s = DICTS[locale][key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll("{" + k + "}", String(v))
    }
  }
  return s
}

export function useTranslations() {
  const { settings } = useSettings()
  return (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(settings.locale, key, params)
}

export function useLocale(): Locale {
  return useSettings().settings.locale
}
