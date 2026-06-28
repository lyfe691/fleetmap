"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

/** Shared light/dark toggle behavior + next-themes hydration guard. */
export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // Hydration guard: the one-shot post-mount flip is intentional.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const isDark = resolvedTheme === "dark"
  return {
    mounted,
    isDark,
    label: isDark ? "Switch to light theme" : "Switch to dark theme",
    toggle: () => setTheme(isDark ? "light" : "dark"),
  }
}

export function ThemeToggle({ className }: { className?: string }) {
  const { mounted, isDark, label, toggle } = useThemeToggle()

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={toggle}
      className={cn(
        "flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      {/* Moon is the pre-mount default; flip only after mount to avoid a hydration mismatch. */}
      {mounted && isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}
