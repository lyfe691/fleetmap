import Link from "next/link"
import { ChevronRight, MapIcon, Navigation } from "lucide-react"
import { BubbleboxLogo } from "@/components/console/bubblebox-logo"
import { ThemeToggle } from "@/components/theme-toggle"

export default function Page() {
  return (
    <main className="relative flex min-h-svh items-center justify-center bg-background px-6 text-foreground">
      <Graticule />

      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <header className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-card">
            <BubbleboxLogo className="size-6 text-foreground" />
          </span>
          <span className="leading-tight">
            <span className="block font-heading text-xl font-semibold tracking-tight">
              Fleetmap
            </span>
            <span className="block text-sm text-muted-foreground">
              Fleet monitoring
            </span>
          </span>
        </header>

        <nav className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <Entry
            href="/dashboard"
            icon={<MapIcon className="size-6" />}
            name="Monitoring console"
            sub="Live map, routes & ETAs — for the office screen"
          />
          <div className="h-px bg-border" />
          {/* The driver client now lives in Roman's native Bubblebox app (it
              needs background location the web PWA can't do). Retired from this
              site; the /driver route stays only as a reference for that port. */}
          <Entry
            icon={<Navigation className="size-6" />}
            name="Driver"
            sub="Now part of the Bubblebox app"
            disabled
            badge="Moved"
          />
        </nav>
      </div>
    </main>
  )
}

function Entry({
  href,
  icon,
  name,
  sub,
  disabled = false,
  badge,
}: {
  href?: string
  icon: React.ReactNode
  name: string
  sub: string
  disabled?: boolean
  badge?: string
}) {
  const body = (
    <>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold tracking-tight">{name}</span>
        <span className="mt-0.5 block truncate text-sm text-muted-foreground">{sub}</span>
      </span>
      {badge ? (
        <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {badge}
        </span>
      ) : (
        <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  )

  if (disabled || !href) {
    return (
      <div
        aria-disabled
        className="flex cursor-not-allowed items-center gap-4 px-5 py-4 opacity-55"
      >
        {body}
      </div>
    )
  }

  return (
    <Link
      href={href}
      className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/60"
    >
      {body}
    </Link>
  )
}

function Graticule() {
  // Subtle dot grid evoking a map graticule, faded out toward the center.
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-50 dark:opacity-30"
      style={{
        backgroundImage:
          "radial-gradient(circle at center, var(--border) 1px, transparent 1px)",
        backgroundSize: "30px 30px",
        maskImage: "radial-gradient(70% 55% at 50% 50%, transparent 55%, black)",
        WebkitMaskImage: "radial-gradient(70% 55% at 50% 50%, transparent 55%, black)",
      }}
    />
  )
}
