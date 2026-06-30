"use client"

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { motion, useReducedMotion } from "motion/react"
import {
  Fuel,
  Gauge,
  ImageIcon,
  MapPin,
  Package,
  Scale,
  Thermometer,
  Truck,
  User,
  type LucideIcon,
} from "lucide-react"
import { FleetMapView } from "@/components/map/fleet-map-view"
import type { LiveData } from "@/lib/console/types"
import type { ConsoleVehicle } from "@/lib/console/use-console-data"
import { assumedCargoPhotos, assumedManifest } from "@/lib/console/assumed"
import { StatusBadge } from "@/components/console/status-badge"
import { PlaceholderNote } from "@/components/console/placeholder-note"
import { useTranslations } from "@/lib/i18n"
import type { TranslationKey } from "@/lib/i18n/en"
import { cn } from "@/lib/utils"

// The detail panel is one scrolling page: stacked sections with a sticky
// jump-nav instead of tabs (fewer clicks — everything's one scroll away). The
// console is a single route with view state in React, not the URL, so the nav
// only scrolls + highlights; it deliberately doesn't read or write the hash
// (that would resurface the last section when you leave and re-enter the view).
type SectionDef = { id: string; label: TranslationKey }
const SECTIONS: readonly SectionDef[] = [
  { id: "overview", label: "tab.Overview" },
  { id: "vehicle", label: "tab.Vehicle" },
  { id: "cargo", label: "tab.Cargo" },
]
const SECTION_IDS = SECTIONS.map((s) => s.id)

const spring = {
  type: "spring",
  stiffness: 350,
  damping: 30,
  mass: 0.8,
} as const

export function TrackingView({
  vehicle,
  live,
  onLocate,
}: {
  vehicle: ConsoleVehicle
  live: LiveData
  onLocate: () => void
}) {
  const t = useTranslations()
  const scrollRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  // Measure the sticky nav so the active-section line + scroll offsets follow its
  // real height. It's rem-based, so it grows with the root font-size on a big TV
  // — a hardcoded px offset would drift and highlight the wrong section.
  const [navH, setNavH] = useState(76)
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const measure = () => setNavH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The "current" line sits just below the nav; clicked sections land here too.
  const offset = navH + 12
  const active = useScrollSpy(scrollRef, vehicle.id, offset)

  // Switching vehicles resets to the top — the previous scroll position carries
  // no meaning for a different van.
  const prevId = useRef(vehicle.id)
  useEffect(() => {
    if (prevId.current === vehicle.id) return
    prevId.current = vehicle.id
    scrollRef.current?.scrollTo({ top: 0 })
  }, [vehicle.id])

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto scroll-smooth"
      style={{ scrollPaddingTop: offset }}
    >
      <div className="mx-auto max-w-[75rem] px-8 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-4 pt-7">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <h2 className="text-[1.75rem] leading-none font-semibold tracking-tight">
                {vehicle.reg}
              </h2>
              <StatusBadge tone={vehicle.tone} size="md" />
            </div>
            <p className="mt-2 truncate text-[0.9375rem] text-muted-foreground">
              {vehicle.driver} · {vehicle.model}
            </p>
          </div>
          <button
            type="button"
            onClick={onLocate}
            className="flex h-14 items-center gap-2 rounded-full bg-primary px-6 text-[1rem] font-semibold text-primary-foreground shadow-md transition-[filter] active:brightness-90"
          >
            <MapPin className="size-5" />
            {t("tracking.locateOnMap")}
          </button>
        </header>

        <SectionNav active={active} navRef={navRef} />

        <Section id="overview" title={t("tab.Overview")}>
          <OverviewBody vehicle={vehicle} live={live} />
        </Section>
        <Section id="vehicle" title={t("tab.Vehicle")}>
          <VehicleBody vehicle={vehicle} />
        </Section>
        <Section
          id="cargo"
          title={t("tab.Cargo")}
          fill={`calc(100vh - ${navH}px)`}
        >
          <CargoBody vehicle={vehicle} />
        </Section>
      </div>
    </div>
  )
}

// Active = the last section whose top has scrolled above the line under the nav.
// A rAF-throttled scroll listener is simpler and more predictable here than an
// IntersectionObserver with hand-tuned rootMargins. The last section's min-height
// (see <Section fill>) guarantees it can scroll up to the line, so this plain rule
// lands on it too — no special-casing the end of the scroll. `offset` is the live
// nav height (re-inits on resize/scaling); `resetKey` re-inits on vehicle change.
function useScrollSpy(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  resetKey: string,
  offset: number
) {
  const [active, setActive] = useState(SECTION_IDS[0])
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    let raf = 0
    const compute = () => {
      raf = 0
      const line = root.getBoundingClientRect().top + offset
      let current = SECTION_IDS[0]
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    compute()
    return () => {
      root.removeEventListener("scroll", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, resetKey, offset])
  return active
}

function SectionNav({
  active,
  navRef,
}: {
  active: string
  navRef: React.RefObject<HTMLDivElement | null>
}) {
  const t = useTranslations()
  const reduceMotion = useReducedMotion()
  const layoutId = useId()

  // Scroll to the section without touching the URL (no router here). The href is
  // a real in-page anchor for semantics + keyboard, but the click is intercepted
  // so a tap doesn't push a #hash into the address bar.
  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "start" })
  }

  return (
    <div
      ref={navRef}
      className="sticky top-0 z-40 -mx-8 mt-7 border-b border-border/60 bg-background/80 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70"
    >
      <nav
        aria-label={t("tracking.tabList")}
        className="inline-flex items-center rounded-full bg-muted p-1"
      >
        {SECTIONS.map((s) => {
          const isActive = active === s.id
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={isActive ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault()
                jumpTo(s.id)
              }}
              className={cn(
                "relative isolate rounded-full px-5 py-3 text-[0.9375rem] font-semibold whitespace-nowrap outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              {isActive ? (
                <motion.span
                  layoutId={`section-${layoutId}`}
                  transition={reduceMotion ? { duration: 0 } : spring}
                  style={{ borderRadius: 999 }}
                  className="absolute inset-0 -z-10 rounded-full bg-background shadow-sm ring-1 ring-black/4 dark:bg-foreground/10 dark:shadow-none dark:ring-white/5"
                />
              ) : null}
              <span className="relative">{t(s.label)}</span>
            </a>
          )
        })}
      </nav>
    </div>
  )
}

function Section({
  id,
  title,
  children,
  fill,
}: {
  id: string
  title: string
  children: ReactNode
  // The last section is shorter than the viewport, so on its own it can't scroll
  // its top up under the nav — the jump lands short and the previous section
  // stays on screen. Pass a min-height (~one viewport minus the nav) to give it
  // the room to reach the top, which also makes the scroll-spy land on it. The
  // scroll offset itself is handled by the container's scroll-padding-top.
  fill?: string
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="pt-9"
      style={fill ? { minHeight: fill } : undefined}
    >
      <h3
        id={`${id}-heading`}
        className="font-heading text-xl font-semibold tracking-tight"
      >
        {title}
      </h3>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function OverviewBody({
  vehicle,
  live,
}: {
  vehicle: ConsoleVehicle
  live: LiveData
}) {
  const t = useTranslations()
  const miniLive: LiveData = useMemo(() => {
    const raw = live.vehicles.find((v) => v.id === vehicle.id)
    const stops = live.stopsByVehicle.get(vehicle.id) ?? []
    const route = live.routes.get(vehicle.id)
    return {
      vehicles: raw ? [raw] : [],
      stopsByVehicle: raw ? new Map([[vehicle.id, stops]]) : new Map(),
      routes: route ? new Map([[vehicle.id, route]]) : new Map(),
      now: live.now,
    }
  }, [vehicle.id, live])

  return (
    <div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card label={t("tracking.loadCapacity")}>
          <div className="mt-3 flex items-center gap-3">
            <span className="font-heading text-[3.25rem] leading-none font-bold tracking-tight">
              {vehicle.capacityPct}%
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bubblebox-van-tight.png"
              alt=""
              draggable={false}
              className="ml-auto h-[5.5rem] w-auto object-contain"
            />
          </div>
          <p className="mt-4 text-[0.9375rem] text-muted-foreground">
            {t("tracking.loadSummary", { n: vehicle.loadCount, weight: vehicle.loadWeight })}
          </p>
          <PlaceholderNote className="mt-2" textKey="placeholder.telematics" />
        </Card>

        <Card label={t("tracking.routeProgress")}>
          <div className="mt-3 font-mono text-[2.5rem] font-semibold tracking-tight">
            {vehicle.routeTimer}
          </div>
          <p className="mt-1 text-[0.9375rem] text-muted-foreground">
            {vehicle.routeLeftText}
          </p>
          <div className="mt-auto flex items-center gap-3 pt-5 text-[0.9375rem]">
            <span className="text-muted-foreground">{vehicle.origin}</span>
            <div className="relative h-1 flex-1 rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${vehicle.routeProgressPct}%` }}
              />
            </div>
            <span className="font-semibold">{vehicle.dest}</span>
          </div>
        </Card>
      </div>

      <h4 className="mt-7 font-heading text-lg font-semibold">{t("tracking.liveLocation")}</h4>
      {/* Viewport-relative so the map grows with the screen instead of sitting at
          a fixed 460px island on a big wall TV — floored/capped to stay sane on
          laptops and very tall displays. */}
      <div className="mt-3 h-[clamp(420px,52vh,760px)] overflow-hidden rounded-2xl border border-border shadow-[var(--shadow-card)]">
        <FleetMapView
          vehicles={miniLive.vehicles}
          stopsByVehicle={miniLive.stopsByVehicle}
          routes={miniLive.routes}
          now={miniLive.now}
          showChrome={false}
        />
      </div>
    </div>
  )
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="text-[0.875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

type DetailRow = {
  id: string
  icon: LucideIcon
  label: string
  sub: string
  value: string
  good?: boolean
}

function VehicleBody({ vehicle }: { vehicle: ConsoleVehicle }) {
  const t = useTranslations()
  const rows: DetailRow[] = [
    { id: "model", icon: Truck, label: vehicle.model, sub: t("tracking.vehicleModel"), value: vehicle.plate },
    { id: "driver", icon: User, label: vehicle.driver, sub: t("tracking.assignedDriver"), value: t("tracking.onShift"), good: true },
    { id: "odo", icon: Gauge, label: t("tracking.odometer"), sub: t("tracking.totalDistance"), value: vehicle.odometer },
    { id: "fuel", icon: Fuel, label: t("tracking.fuelLevel"), sub: t("tracking.currentTank"), value: `${vehicle.fuelPct}%`, good: true },
    { id: "temp", icon: Thermometer, label: t("tracking.cargoTemperature"), sub: t("tracking.cargoHold"), value: vehicle.cargoTemp },
  ]
  return (
    <div className="flex flex-col gap-3">
      <PlaceholderNote textKey="placeholder.telematics" />
      {rows.map((r) => (
        <DetailRowItem key={r.id} row={r} />
      ))}
    </div>
  )
}

function CargoBody({ vehicle }: { vehicle: ConsoleVehicle }) {
  const t = useTranslations()
  const photos = assumedCargoPhotos(vehicle.id)
  const manifest = assumedManifest(vehicle.id)
  const manifestIcons: Record<string, LucideIcon> = {
    pkg: Package,
    gross: Scale,
    temp: Thermometer,
  }
  return (
    <div>
      <PlaceholderNote textKey="placeholder.telematics" />
      <h4 className="mt-4 font-heading text-lg font-semibold">
        {t("tracking.cargoPhotoReports")}
      </h4>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {photos.map((p) => (
          <div
            key={p.id}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]"
          >
            <div className="flex h-[8rem] items-center justify-center bg-muted text-muted-foreground">
              <ImageIcon className="size-9" />
            </div>
            <div className="px-4 py-3.5">
              <div className="flex items-center gap-2 text-[0.9375rem] font-semibold">
                <span className="size-2 rounded-full bg-primary" />
                {p.label}
              </div>
              <div className="mt-1 text-[0.8125rem] text-muted-foreground">{p.meta}</div>
            </div>
          </div>
        ))}
      </div>

      <h4 className="mt-8 font-heading text-lg font-semibold">{t("tracking.manifest")}</h4>
      <div className="mt-4 flex flex-col gap-3">
        {manifest.map((m) => (
          <DetailRowItem
            key={m.id}
            row={{
              id: m.id,
              icon: manifestIcons[m.id] ?? Package,
              label: m.label,
              sub: m.sub,
              value: m.value,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function DetailRowItem({ row }: { row: DetailRow }) {
  const Icon = row.icon
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-6 py-5 shadow-[var(--shadow-card)]">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-muted text-muted-foreground">
          <Icon className="size-6" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[1rem] font-semibold">{row.label}</div>
          <div className="mt-0.5 text-[0.875rem] text-muted-foreground">{row.sub}</div>
        </div>
      </div>
      <div
        className={`shrink-0 font-mono text-[1rem] font-semibold ${
          row.good ? "text-success" : "text-foreground"
        }`}
      >
        {row.value}
      </div>
    </div>
  )
}
