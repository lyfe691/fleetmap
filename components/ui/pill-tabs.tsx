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
  /** `lg` is taller with larger type — good for dialogs and full-width bars. */
  size?: "default" | "lg"
  className?: string
}

const sizeStyles = {
  default: {
    list: "h-9",
    tab: "px-4 text-xs sm:px-5 sm:text-sm",
    // 4+ equal tabs (fleet filters): keep height, tighten horizontal chrome.
    tabDense: "px-2 text-xs sm:px-2.5 sm:text-sm",
  },
  lg: {
    list: "h-11 sm:h-12",
    tab: "px-5 text-sm sm:text-base",
    tabDense: "px-2 text-sm sm:px-2.5 sm:text-sm",
  },
} as const

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
  size = "default",
  className,
}: PillTabsProps) {
  const isControlled = activeId !== undefined
  const [uncontrolledActive, setUncontrolledActive] =
    React.useState(defaultActiveId)
  const active = isControlled ? activeId : uncontrolledActive

  const reduceMotion = useReducedMotion()
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const [pill, setPill] = React.useState<{ x: number; width: number } | null>(
    null
  )
  // The pill used to live inside the button, so whileTap squeezed it too;
  // now that it's container-level, mirror the press on the active tab.
  const [activePressed, setActivePressed] = React.useState(false)

  const activeIndex = tabs.findIndex((tab) => tab.id === active)

  // Position the pill from offsetLeft/offsetWidth — parent-relative values
  // that page scroll cannot contaminate, unlike layoutId's page-space
  // snapshots (which jumped whenever scroll shifted mid-transition).
  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const measure = () => {
      const el = activeIndex >= 0 ? tabRefs.current[activeIndex] : null
      setPill((prev) => {
        if (!el) return null
        const next = { x: el.offsetLeft, width: el.offsetWidth }
        return prev && prev.x === next.x && prev.width === next.width
          ? prev
          : next
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    for (const el of tabRefs.current) {
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [activeIndex, tabs.length, size])

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

  if (tabs.length === 0) return null

  const styles = sizeStyles[size]
  // Four (or more) equal-width tabs need denser horizontal padding so long
  // labels + counts don't paint over neighbours. Height / touch target stay.
  const dense = tabs.length >= 4

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        "relative inline-flex min-w-0 items-center",
        styles.list,
        className
      )}
    >
      <div
        aria-hidden
        className="absolute inset-x-1 inset-y-0.5 rounded-full bg-muted"
      />
      {pill && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0 rounded-full bg-background ring-1 ring-black/5 ring-inset dark:ring-white/10"
          initial={false}
          animate={{
            x: pill.x,
            width: pill.width,
            scale: activePressed && !reduceMotion ? 0.96 : 1,
          }}
          transition={reduceMotion ? { duration: 0 } : spring}
        />
      )}
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
            tabIndex={
              activeIndex >= 0 ? (isActive ? 0 : -1) : index === 0 ? 0 : -1
            }
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            onTapStart={() => isActive && setActivePressed(true)}
            onTap={() => setActivePressed(false)}
            onTapCancel={() => setActivePressed(false)}
            whileTap={reduceMotion ? undefined : { scale: 0.96 }}
            className={cn(
              // min-w-0 + overflow-hidden: flex-1 tabs must be allowed to
              // shrink or long nowrap labels bleed into the next tab.
              "relative h-full min-w-0 flex-1 overflow-hidden rounded-full font-medium outline-none select-none",
              dense ? styles.tabDense : styles.tab,
              "transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            <span className="relative flex min-w-0 items-center justify-center gap-1">
              {tab.label}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
