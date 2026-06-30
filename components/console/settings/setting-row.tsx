"use client"

import type { ReactNode } from "react"

// Rendered as a <label> so tapping anywhere on the row (title, description, or
// the control) activates the control — a big touch target for the wall-mounted
// TV. Native label forwarding toggles the Switch / opens the Select.
export function SettingRow({
  title,
  description,
  control,
}: {
  title: string
  description?: string
  control: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-border py-4 transition-colors last:border-0 active:bg-muted/40">
      <div className="min-w-0">
        <div className="text-[0.9375rem] font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </label>
  )
}
