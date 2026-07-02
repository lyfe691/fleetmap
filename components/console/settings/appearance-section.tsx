"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTheme } from "next-themes"
import { useTranslations } from "@/lib/i18n/index"

type ThemeChoice = "system" | "light" | "dark"

const CHOICES: ThemeChoice[] = ["system", "light", "dark"]

const badgeSpring = {
  type: "spring",
  stiffness: 500,
  damping: 28,
} as const

// Mini console scene per theme — colors mirror the app tokens / map-theme
// palettes, hardcoded because SVG can't read the *other* theme's CSS vars.
type PreviewPalette = {
  bg: string
  panel: string
  muted: string
  route: string
  dot: string
}

const LIGHT: PreviewPalette = {
  bg: "#f4f4f2",
  panel: "#ffffff",
  muted: "#e7e7e4",
  route: "#1bbecd",
  dot: "#16a34a",
}

const DARK: PreviewPalette = {
  bg: "#18181b",
  panel: "#27272b",
  muted: "#37373c",
  route: "#34d3df",
  dot: "#34d399",
}

export function AppearanceSection() {
  const { theme, setTheme } = useTheme()
  const t = useTranslations()
  const reduceMotion = useReducedMotion()
  const tileRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const active = (theme ?? "system") as ThemeChoice

  const labels: Record<ThemeChoice, string> = {
    system: t("settings.theme.system"),
    light: t("settings.theme.light"),
    dark: t("settings.theme.dark"),
  }

  // Roving focus + arrow selection (WAI-ARIA radio group pattern).
  function focusTile(index: number) {
    const next = (index + CHOICES.length) % CHOICES.length
    tileRefs.current[next]?.focus()
    setTheme(CHOICES[next])
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault()
        focusTile(index + 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault()
        focusTile(index - 1)
        break
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] text-muted-foreground">{t("settings.theme.desc")}</p>
      <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-3 gap-3">
        {CHOICES.map((choice, index) => {
          const isActive = active === choice
          return (
            <motion.button
              key={choice}
              ref={(node) => {
                tileRefs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setTheme(choice)}
              onKeyDown={(event) => onKeyDown(event, index)}
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * index, duration: 0.25, ease: "easeOut" }}
              whileTap={reduceMotion ? undefined : { scale: 0.97 }}
              className={`group relative flex flex-col gap-2 rounded-2xl border p-2 pb-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                isActive
                  ? "border-primary bg-muted/60 ring-2 ring-primary/25"
                  : "border-border hover:bg-muted/40"
              }`}
            >
              <span className="relative overflow-hidden rounded-xl border border-border">
                <ThemePreview choice={choice} active={isActive && !reduceMotion} />
              </span>
              <AnimatePresence>
                {isActive ? (
                  <motion.span
                    initial={reduceMotion ? false : { scale: 0.4, opacity: 0, rotate: -45 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={reduceMotion ? undefined : { scale: 0.4, opacity: 0 }}
                    transition={reduceMotion ? { duration: 0 } : badgeSpring}
                    className="absolute top-3.5 right-3.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
                  >
                    <Check className="size-4" strokeWidth={3} />
                  </motion.span>
                ) : null}
              </AnimatePresence>
              <span
                className={`text-[0.875rem] font-medium transition-colors ${
                  isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80"
                }`}
              >
                {labels[choice]}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

function ThemePreview({ choice, active }: { choice: ThemeChoice; active: boolean }) {
  const clipId = React.useId()
  if (choice !== "system") {
    return (
      <svg viewBox="0 0 120 74" className="block h-auto w-full" aria-hidden>
        <Scene p={choice === "light" ? LIGHT : DARK} active={active} />
      </svg>
    )
  }
  // System: the classic split tile — light left, dark right.
  return (
    <svg viewBox="0 0 120 74" className="block h-auto w-full" aria-hidden>
      <defs>
        <clipPath id={`${clipId}-l`}>
          <path d="M0 0h72L48 74H0z" />
        </clipPath>
        <clipPath id={`${clipId}-r`}>
          <path d="M72 0h48v74H48z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId}-l)`}>
        <Scene p={LIGHT} active={active} />
      </g>
      <g clipPath={`url(#${clipId}-r)`}>
        <Scene p={DARK} active={active} />
      </g>
    </svg>
  )
}

const ROUTE_D = "M38 42 C 52 18, 68 46, 84 26 S 102 16, 106 14"

function Scene({ p, active }: { p: PreviewPalette; active: boolean }) {
  return (
    <>
      <rect width="120" height="74" fill={p.bg} />
      {/* sidebar */}
      <rect x="6" y="6" width="18" height="62" rx="4" fill={p.panel} />
      <rect x="10" y="12" width="10" height="3.5" rx="1.75" fill={p.muted} />
      <rect x="10" y="19" width="10" height="3.5" rx="1.75" fill={p.muted} />
      <rect x="10" y="26" width="10" height="3.5" rx="1.75" fill={p.route} opacity="0.85" />
      {/* map panel: the route draws itself in and the van dot pops at its end
          whenever this tile becomes the selection — the product's own gesture.
          Keyed so re-selecting replays it; inactive tiles stay static. */}
      <rect x="30" y="6" width="84" height="44" rx="4" fill={p.panel} />
      <circle cx="38" cy="42" r="3" fill={p.muted} />
      {active ? (
        <g key="live">
          <motion.path
            d={ROUTE_D}
            fill="none"
            stroke={p.route}
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, ease: "easeInOut" }}
          />
          <motion.circle
            cx="106"
            cy="14"
            r="4"
            fill={p.dot}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.55, ...badgeSpring }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          />
        </g>
      ) : (
        <g key="static">
          <path d={ROUTE_D} fill="none" stroke={p.route} strokeWidth="3" strokeLinecap="round" />
          <circle cx="106" cy="14" r="4" fill={p.dot} />
        </g>
      )}
      {/* card strip */}
      <rect x="30" y="56" width="40" height="12" rx="3" fill={p.panel} />
      <rect x="74" y="56" width="40" height="12" rx="3" fill={p.panel} />
      <rect x="34" y="60" width="20" height="4" rx="2" fill={p.muted} />
      <rect x="78" y="60" width="14" height="4" rx="2" fill={p.muted} />
    </>
  )
}
