import Link from "next/link"
import { MonitorIcon, ClipboardListIcon } from "lucide-react"
import { BubbleboxLogo } from "@/components/console/bubblebox-logo"

// Front door: two authenticated surfaces now exist (the TV console and the
// dispatcher's order intake), so root can no longer just redirect to one of
// them. Each destination still gates its own access (display code /
// dispatcher login) exactly as before — this page does no auth itself.
export default function Page() {
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-10 bg-background px-4">
      <div className="flex items-center gap-2.5 text-foreground">
        <BubbleboxLogo className="size-7" />
        <span className="font-heading text-lg font-semibold tracking-tight">Fleetmap</span>
      </div>

      <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <LandingCard
          href="/dashboard"
          icon={<MonitorIcon className="size-6" />}
          title="Dashboard"
          description="Live TV monitoring console — every truck, its route, and ETA."
        />
        <LandingCard
          href="/dispatch"
          icon={<ClipboardListIcon className="size-6" />}
          title="Dispatch"
          description="Sign in to enter and manage today's orders."
        />
      </div>
    </main>
  )
}

function LandingCard({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)] transition-colors hover:border-foreground/20"
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        {icon}
      </span>
      <span className="font-heading text-base font-semibold tracking-tight">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </Link>
  )
}
