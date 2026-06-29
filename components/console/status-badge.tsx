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
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${tint} ${
        size === "md" ? "px-3.5 py-1.5 text-[15px]" : "px-3 py-1 text-[13px]"
      }`}
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {t(tone === "onRoute" ? "status.onRoute" : "status.waiting")}
    </span>
  )
}
