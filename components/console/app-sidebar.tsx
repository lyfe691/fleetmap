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
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
        <div className="flex h-11 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bubblebox-van-icon-tight.png"
            alt=""
            draggable={false}
            className="h-7 w-auto object-contain"
          />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="font-heading text-[18px] font-semibold tracking-tight">
            Fleetmap
          </div>
          <div className="mt-0.5 text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
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
      <div className="flex h-[30px] items-center px-3 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
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
      className={`flex h-[52px] items-center gap-3 rounded-[14px] px-3 text-[15px] transition-colors ${
        active
          ? "bg-sidebar-accent font-semibold"
          : "font-medium hover:bg-sidebar-accent"
      }`}
    >
      <span
        className={`flex size-[34px] shrink-0 items-center justify-center rounded-[10px] transition-colors ${
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-muted-foreground"
        }`}
      >
        <Icon className="size-[22px]" />
      </span>
      <span className="flex-1 text-left whitespace-nowrap">{entry.label}</span>
      {entry.badge ? (
        <span className="flex h-[22px] min-w-6 items-center justify-center rounded-full bg-sidebar-foreground/10 px-1.5 text-xs font-semibold">
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
