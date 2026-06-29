"use client"

import * as React from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export type PillTab = {
  id: string
  label: React.ReactNode
  ariaLabel?: string
}

type PillTabsProps = {
  tabs: readonly PillTab[]
  defaultActiveId?: string
  activeId?: string
  onTabChange?: (id: string) => void
  className?: string
}

const spring = {
  type: "spring",
  stiffness: 350,
  damping: 30,
  mass: 0.8,
} as const

export function PillTabs({
  tabs,
  defaultActiveId = tabs[0]?.id,
  activeId,
  onTabChange,
  className,
}: PillTabsProps) {
  const isControlled = activeId !== undefined
  const [uncontrolledActive, setUncontrolledActive] =
    React.useState(defaultActiveId)
  const active = isControlled ? activeId : uncontrolledActive

  const layoutId = React.useId()
  const reduceMotion = useReducedMotion()
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  const select = React.useCallback(
    (id: string) => {
      if (!isControlled) setUncontrolledActive(id)
      onTabChange?.(id)
    },
    [isControlled, onTabChange]
  )

  // Roving focus + automatic activation (WAI-ARIA tablist pattern).
  function focusTab(index: number) {
    const next = (index + tabs.length) % tabs.length
    const tab = tabs[next]
    if (!tab) return
    tabRefs.current[next]?.focus()
    select(tab.id)
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault()
        focusTab(index + 1)
        break
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault()
        focusTab(index - 1)
        break
      case "Home":
        event.preventDefault()
        focusTab(0)
        break
      case "End":
        event.preventDefault()
        focusTab(tabs.length - 1)
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        "inline-flex items-center rounded-full bg-muted p-1",
        className
      )}
    >
      {tabs.map((tab, index) => {
        const isActive = active === tab.id
        return (
          <motion.button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={tab.ariaLabel}
            tabIndex={isActive ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className={cn(
              // TV-sized: comfortable tap target + readable from a distance.
              "relative isolate flex-1 rounded-full px-5 py-3 text-[15px] font-semibold whitespace-nowrap outline-none transition-colors duration-200 ease-out select-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {isActive && (
              <motion.span
                layoutId={`pill-${layoutId}`}
                transition={reduceMotion ? { duration: 0 } : spring}
                style={{ borderRadius: 999 }}
                className="absolute inset-0 -z-10 rounded-full bg-background shadow-sm ring-1 ring-black/4 dark:bg-foreground/10 dark:shadow-none dark:ring-white/5"
              />
            )}
            <span className="relative flex items-center justify-center gap-1.5">
              {tab.label}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
