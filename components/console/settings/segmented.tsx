"use client"

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
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex gap-1 rounded-xl border border-border bg-surface p-1"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
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
