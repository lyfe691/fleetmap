import type { Locale } from "@/lib/settings/types"

const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", "de-CH": "de-CH" }

export function formatClock(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms))
}

export function formatCount(n: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(n)
}

export function formatDay(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d)
}
