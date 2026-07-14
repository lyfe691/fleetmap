"use client"

import type { StatusTone } from "@/lib/console/use-console-data"
import { useTranslations } from "@/lib/i18n"

const TONE_STYLES: Record<StatusTone, { tint: string; dot: string }> = {
  onRoute: { tint: "bg-success/15 text-success", dot: "bg-success" },
  waiting: { tint: "bg-warning/15 text-warning-strong", dot: "bg-warning" },
}

export function StatusBadge({
  tone,
  size = "sm",
}: {
  tone: StatusTone
  size?: "sm" | "md"
}) {
  const t = useTranslations()
  const { tint, dot } = TONE_STYLES[tone]
  // sm matches LateChip / StaleChip so they sit flush in fleet-rail cards.
  // md stays larger for the tracking header (standalone, no chip siblings).
  const sized =
    size === "md"
      ? { shell: "gap-1.5 px-3.5 py-1.5 text-[0.9375rem]", mark: "size-2" }
      : { shell: "gap-1 px-2 py-0.5 text-[0.75rem]", mark: "size-1.5" }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold ${tint} ${sized.shell}`}
    >
      <span className={`rounded-full ${sized.mark} ${dot}`} />
      {t(tone === "onRoute" ? "status.onRoute" : "status.waiting")}
    </span>
  )
}
