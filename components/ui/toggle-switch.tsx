"use client"

import { Check, X } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

// Snappy spring with the faintest overshoot — Apple's duration/bounce notation
// reads cleaner than stiffness/damping and is easier to tune by feel.
const THUMB_SPRING = { type: "spring", duration: 0.3, bounce: 0.2 } as const
// Strong ease-out for the icon swap; the built-in CSS curves are too soft.
const ICON_EASE = [0.23, 1, 0.32, 1] as const

// A big, touch-friendly on/off switch for the wall-mounted console. The thumb
// rides a `layout` animation (driven by the track's justify), so its travel is
// measured from the real layout — it stays correct when the UI scales up on a TV
// instead of relying on a hardcoded translate distance. Same checked /
// onCheckedChange API as the shadcn Switch, so it drops into SettingRow's <label>.
export function ToggleSwitch({
  checked,
  onCheckedChange,
  reduceMotion = false,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  // Pass the app's reduce-motion flag: the framer hook only reads the device's
  // OS media query, not our in-app setting, so we OR the two together here.
  reduceMotion?: boolean
  disabled?: boolean
  className?: string
  "aria-label"?: string
}) {
  const reduce = useReducedMotion() || reduceMotion
  const slide = reduce ? { duration: 0 } : THUMB_SPRING
  const swap = reduce ? { duration: 0 } : { duration: 0.2, ease: ICON_EASE }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative flex h-9 w-16 shrink-0 items-center rounded-full p-1 outline-none transition-colors duration-200 ease-out",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "justify-end bg-brand" : "justify-start bg-input",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {/* Only the selector reacts to the press (whileTap), not the whole track. */}
      <motion.span
        layout
        transition={slide}
        whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
        className="relative grid size-7 place-items-center rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.28)]"
      >
        {/* Both glyphs stay mounted and cross-fade by `checked` — smoother and
            interruptible vs. mount/unmount. A small scale + blur (not a pop) keeps
            the morph soft. Fixed colours: the thumb is white in both themes. */}
        <Glyph show={!checked} transition={swap}>
          <X className="size-4 text-zinc-400" strokeWidth={3.25} />
        </Glyph>
        <Glyph show={checked} transition={swap}>
          <Check className="size-4 text-[#0b8d9a]" strokeWidth={3.25} />
        </Glyph>
      </motion.span>
    </button>
  )
}

function Glyph({
  show,
  transition,
  children,
}: {
  show: boolean
  transition: object
  children: React.ReactNode
}) {
  return (
    <motion.span
      className="absolute inset-0 grid place-items-center"
      initial={false}
      animate={{
        opacity: show ? 1 : 0,
        scale: show ? 1 : 0.8,
        filter: show ? "blur(0px)" : "blur(3px)",
      }}
      transition={transition}
    >
      {children}
    </motion.span>
  )
}
