import type { StatusTone } from "@/lib/console/use-console-data"

export function StatusBadge({
  tone,
  label,
  size = "sm",
}: {
  tone: StatusTone
  label: string
  size?: "sm" | "md"
}) {
  const tint =
    tone === "onRoute"
      ? "bg-success/15 text-success"
      : "bg-warning/15 text-warning-strong"
  const dot = tone === "onRoute" ? "bg-success" : "bg-warning"
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${tint} ${
        size === "md" ? "px-3 py-1 text-[13px]" : "px-2.5 py-1 text-xs"
      }`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
