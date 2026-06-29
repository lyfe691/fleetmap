"use client"

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex h-10 items-center"
    >
      <span
        className={`relative flex h-7 w-[52px] items-center rounded-full px-1 transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`size-5 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-[24px]" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  )
}
