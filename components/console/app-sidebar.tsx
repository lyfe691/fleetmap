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
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bubblebox-van-icon-tight.png"
            alt=""
            draggable={false}
            className="h-7 w-auto object-contain"
          />
        </div>
        <div className="leading-none">
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

function OnlinePill({ online, total }: { online: number; total: number }) {
  const now = useNow(30_000)
  const d = new Date(now)
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`
  return (
    <div className="flex flex-1 items-center gap-2.5 rounded-2xl bg-sidebar-accent px-4 py-3.5">
      <span className="relative flex size-3 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-3 rounded-full bg-success" />
      </span>
      <span className="flex-1 text-[15px] font-semibold">
        {online} of {total} online
      </span>
      <span className="shrink-0 font-mono text-[13px] text-muted-foreground">{clock}</span>
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
      className="flex w-[60px] shrink-0 items-center justify-center rounded-2xl border border-sidebar-border text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
    >
      {isDark ? <Sun className="size-6" /> : <Moon className="size-6" />}
    </button>
  )
}
