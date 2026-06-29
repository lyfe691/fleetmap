"use client"

import type { ReactNode } from "react"

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
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
