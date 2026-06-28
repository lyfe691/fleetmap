"use client"

import {
  ChevronsLeft,
  ChevronsRight,
  History as HistoryIcon,
  Map as MapIcon,
  Moon,
  Navigation,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { useThemeToggle } from "@/components/theme-toggle"
import { useNow } from "@/lib/use-now"
import { CLOCK_TICK_MS } from "@/lib/console/intervals"
import type { ConsoleView } from "@/lib/console/types"
import { BubbleboxLogo } from "@/components/console/bubblebox-logo"

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
  collapsed,
  onToggleCollapse,
}: {
  view: ConsoleView
  onNavigate: (view: ConsoleView) => void
  onlineCount: number
  totalCount: number
  onRouteCount: number
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const monitor: NavEntry[] = [
    { id: "tracking", label: "Live Tracking", icon: Navigation, badge: onRouteCount },
    { id: "map", label: "Live Map", icon: MapIcon },
  ]
  const records: NavEntry[] = [{ id: "history", label: "History", icon: HistoryIcon }]

  if (collapsed) {
    return (
      <aside className="flex h-full w-[76px] shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <BubbleboxLogo className="size-7 text-foreground" />
        </div>

        <nav className="mt-5 flex flex-1 flex-col items-center gap-1.5">
          {[...monitor, ...records].map((e) => (
            <IconNavItem
              key={e.id}
              entry={e}
              active={view === e.id}
              onClick={() => onNavigate(e.id)}
            />
          ))}
        </nav>

        <div className="flex flex-col items-center gap-2">
          <ThemeToggle collapsed />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            className="flex size-11 items-center justify-center rounded-xl border border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronsRight className="size-5" />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex h-full w-[262px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted">
          <BubbleboxLogo className="size-7 text-foreground" />
        </div>
        <div className="min-w-0 leading-none">
          <div className="font-heading text-[20px] font-semibold tracking-tight">
            Fleetmap
          </div>
          <div className="mt-1.5 text-[13px] text-muted-foreground">
            Monitoring Console
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
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

      <div className="flex flex-col gap-2.5 border-t border-sidebar-border p-3">
        <OnlinePill online={onlineCount} total={totalCount} />
        <div className="flex gap-2.5">
          <ThemeToggle />
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-sidebar-border text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronsLeft className="size-5" />
          </button>
        </div>
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
      <div className="px-3.5 pt-3 pb-1.5 text-[12px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
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
      className={`flex h-14 items-center gap-3.5 rounded-xl px-3.5 text-[16px] font-medium transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="size-6 shrink-0" />
      <span className="flex-1 text-left whitespace-nowrap">{entry.label}</span>
      {entry.badge ? (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[13px] font-semibold text-success tabular-nums">
          {entry.badge}
        </span>
      ) : null}
    </button>
  )
}

function IconNavItem({
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
      title={entry.label}
      aria-label={entry.label}
      aria-current={active ? "page" : undefined}
      className={`relative flex size-12 items-center justify-center rounded-xl transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"
      }`}
    >
      <Icon className="size-6" />
      {entry.badge ? (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1 text-[11px] font-bold text-success-foreground tabular-nums">
          {entry.badge}
        </span>
      ) : null}
    </button>
  )
}

function OnlinePill({ online, total }: { online: number; total: number }) {
  const now = useNow(CLOCK_TICK_MS)
  const d = new Date(now)
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-sidebar-accent px-4 py-3.5">
      <span className="relative flex size-3 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-3 rounded-full bg-success" />
      </span>
      <span className="flex-1 text-[15px] font-semibold">
        {online} of {total} online
      </span>
      <span className="shrink-0 font-mono text-[13px] text-muted-foreground">
        {clock}
      </span>
    </div>
  )
}

function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  // ssr:false console, so the hook's mounted guard isn't needed here.
  const { isDark, label, toggle } = useThemeToggle()

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={toggle}
        className="flex size-11 items-center justify-center rounded-xl border border-sidebar-border text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      >
        {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={toggle}
      className="flex h-12 flex-1 items-center justify-center gap-2.5 rounded-2xl border border-sidebar-border text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  )
}
