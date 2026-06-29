"use client"

import { Settings } from "lucide-react"

export function SettingsButton({
  onClick,
  collapsed,
}: {
  onClick: () => void
  collapsed?: boolean
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Settings"
        title="Settings"
        className="flex size-11 items-center justify-center rounded-xl border border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <Settings className="size-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Settings"
      className="flex h-12 flex-1 items-center justify-center gap-2.5 rounded-2xl border border-sidebar-border text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      <Settings className="size-5" />
      Settings
    </button>
  )
}
