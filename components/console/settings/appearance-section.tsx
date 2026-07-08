"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { useTranslations } from "@/lib/i18n/index"
import type { TranslationKey } from "@/lib/i18n/en"

type ThemeChoice = "system" | "light" | "dark"

const CHOICES: { value: ThemeChoice; labelKey: TranslationKey }[] = [
  { value: "system", labelKey: "settings.theme.system" },
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
]

// Mirrors the app tokens / map-theme palettes; hardcoded because each preview
// must render the *other* theme's colors, which CSS vars can't reach.
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
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])
  const active = (theme ?? "system") as ThemeChoice

  function select(index: number) {
    const next = (index + CHOICES.length) % CHOICES.length
    refs.current[next]?.focus()
    setTheme(CHOICES[next].value)
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault()
        select(index + 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault()
        select(index - 1)
        break
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.8125rem] text-muted-foreground">{t("settings.theme.desc")}</p>
      <div role="radiogroup" aria-label={t("settings.theme")} className="grid grid-cols-3 gap-3">
        {CHOICES.map((choice, index) => {
          const isActive = active === choice.value
          return (
            <button
              key={choice.value}
              ref={(node) => {
                refs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setTheme(choice.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "group flex flex-col gap-2 rounded-2xl border p-2 pb-2.5 transition duration-200 outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98]",
                isActive
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:bg-muted/40"
              )}
            >
              <span className="relative overflow-hidden rounded-xl border border-border">
                <ThemePreview choice={choice.value} />
                <span
                  className={cn(
                    "absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition duration-200",
                    isActive ? "scale-100 opacity-100" : "scale-50 opacity-0"
                  )}
                >
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
              </span>
              <span
                className={cn(
                  "text-[0.875rem] font-medium transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80"
                )}
              >
                {t(choice.labelKey)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ThemePreview({ choice }: { choice: ThemeChoice }) {
  const clipId = React.useId()
  if (choice !== "system") {
    return (
      <svg viewBox="0 0 120 74" className="block h-auto w-full" aria-hidden>
        <Scene p={choice === "light" ? LIGHT : DARK} />
      </svg>
    )
  }
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
        <Scene p={LIGHT} />
      </g>
      <g clipPath={`url(#${clipId}-r)`}>
        <Scene p={DARK} />
      </g>
    </svg>
  )
}

function Scene({ p }: { p: PreviewPalette }) {
  return (
    <>
      <rect width="120" height="74" fill={p.bg} />
      <rect x="6" y="6" width="18" height="62" rx="4" fill={p.panel} />
      <rect x="10" y="12" width="10" height="3.5" rx="1.75" fill={p.muted} />
      <rect x="10" y="19" width="10" height="3.5" rx="1.75" fill={p.muted} />
      <rect x="10" y="26" width="10" height="3.5" rx="1.75" fill={p.route} opacity="0.85" />
      <rect x="30" y="6" width="84" height="44" rx="4" fill={p.panel} />
      <circle cx="38" cy="42" r="3" fill={p.muted} />
      <path
        d="M38 42 C 52 18, 68 46, 84 26 S 102 16, 106 14"
        fill="none"
        stroke={p.route}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="106" cy="14" r="4" fill={p.dot} />
      <rect x="30" y="56" width="40" height="12" rx="3" fill={p.panel} />
      <rect x="74" y="56" width="40" height="12" rx="3" fill={p.panel} />
      <rect x="34" y="60" width="20" height="4" rx="2" fill={p.muted} />
      <rect x="78" y="60" width="14" height="4" rx="2" fill={p.muted} />
    </>
  )
}
