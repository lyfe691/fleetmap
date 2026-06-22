"use client"

import {
  History as HistoryIcon,
  Map as MapIcon,
  Moon,
  Navigation,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useNow } from "@/lib/use-now"
import type { ConsoleView } from "@/lib/console/types"

type NavEntry = {
  id: ConsoleView
  label: string
  icon: LucideIcon
  badge?: number
}

export function AppSidebar({
  view,
  onNavigate,
  onlineCount,
  totalCount,
  onRouteCount,
}: {
  view: ConsoleView
  onNavigate: (view: ConsoleView) => void
  onlineCount: number
  totalCount: number
  onRouteCount: number
}) {
  const monitor: NavEntry[] = [
    { id: "tracking", label: "Live Tracking", icon: Navigation, badge: onRouteCount },
    { id: "map", label: "Live Map", icon: MapIcon },
  ]
  const records: NavEntry[] = [{ id: "history", label: "History", icon: HistoryIcon }]

  return (
    <aside className="flex h-full w-[262px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bubblebox-van-icon-tight.png"
            alt=""
            draggable={false}
            className="h-5 w-auto object-contain"
          />
        </div>
        <div className="leading-none">
          <div className="font-heading text-[15px] font-semibold tracking-tight">
            Fleetmap
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Monitoring Console
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-1.5">
        <NavGroup label="Monitor">
          {monitor.map((e) => (
            <NavItem
              key={e.id}
              entry={e}
              active={view === e.id}
              onClick={() => onNavigate(e.id)}
            />
          ))}
        </NavGroup>
        <NavGroup label="Records" className="mt-2">
          {records.map((e) => (
            <NavItem
              key={e.id}
              entry={e}
              active={view === e.id}
              onClick={() => onNavigate(e.id)}
            />
          ))}
        </NavGroup>
      </div>

      <div className="flex items-stretch gap-2.5 border-t border-sidebar-border p-3">
        <OnlinePill online={onlineCount} total={totalCount} />
        <ThemeToggle />
      </div>
    </aside>
  )
}

function NavGroup({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function NavItem({
  entry,
  active,
  onClick,
}: {
  entry: NavEntry
  active: boolean
  onClick: () => void
}) {
  const Icon = entry.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="size-[18px] shrink-0" />
      <span className="flex-1 text-left whitespace-nowrap">{entry.label}</span>
      {entry.badge ? (
        <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success tabular-nums">
          {entry.badge}
        </span>
      ) : null}
    </button>
  )
}

function OnlinePill({ online, total }: { online: number; total: number }) {
  const now = useNow(30_000)
  const d = new Date(now)
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`
  return (
    <div className="flex flex-1 items-center gap-2.5 rounded-[14px] bg-sidebar-accent px-3.5 py-2.5">
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-success" />
      </span>
      <span className="flex-1 text-[13.5px] font-semibold">
        {online} of {total} online
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{clock}</span>
    </div>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex min-h-11 w-[52px] shrink-0 items-center justify-center rounded-[14px] border border-sidebar-border text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}
