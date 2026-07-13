"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useSettings } from "@/lib/settings/settings-provider"
import { cn } from "@/lib/utils"

// No bounce: the main region reflows with the panel, so overshoot would
// jiggle the map.
const WIDTH_SPRING = { type: "spring", duration: 0.45, bounce: 0 } as const
const FADE = { duration: 0.16, ease: "easeOut" } as const

// Animated shell for the console's collapsible panels. The two content trees
// stay as-is; each renders in a fixed-width layer so text crops behind the
// moving edge instead of reflowing, and AnimatePresence cross-fades the swap.
export function CollapsiblePanel({
  collapsed,
  collapsedWidth,
  expandedWidth,
  className,
  collapsedContent,
  expandedContent,
}: {
  collapsed: boolean
  collapsedWidth: string
  expandedWidth: string
  className?: string
  collapsedContent: ReactNode
  expandedContent: ReactNode
}) {
  const { settings } = useSettings()
  // The framer hook only reads the OS media query, so OR in the in-app flag.
  const reduce = useReducedMotion() || settings.reduceMotion
  const width = collapsed ? collapsedWidth : expandedWidth

  return (
    <motion.aside
      initial={false}
      animate={{ width }}
      transition={reduce ? { duration: 0 } : WIDTH_SPRING}
      className={cn("relative h-full shrink-0 overflow-hidden", className)}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={collapsed ? "collapsed" : "expanded"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : FADE}
          style={{ width }}
          className="absolute inset-y-0 left-0"
        >
          {collapsed ? collapsedContent : expandedContent}
        </motion.div>
      </AnimatePresence>
    </motion.aside>
  )
}
