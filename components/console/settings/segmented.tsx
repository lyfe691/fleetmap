"use client"

import { useRef } from "react"

type Option = { value: string; label: string }

export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Option[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    const last = options.length - 1
    let next: number | null = null

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = index < last ? index + 1 : 0
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = index > 0 ? index - 1 : last
    } else if (e.key === "Home") {
      next = 0
    } else if (e.key === "End") {
      next = last
    }

    if (next !== null) {
      e.preventDefault()
      onChange(options[next].value)
      buttonRefs.current[next]?.focus()
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex gap-1 rounded-xl border border-border bg-surface p-1"
    >
      {options.map((option, index) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => { buttonRefs.current[index] = el }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={`flex h-10 items-center justify-center rounded-lg px-4 text-[14px] font-medium whitespace-nowrap transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
