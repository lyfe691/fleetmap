import type { ReactNode } from "react"

export function PlaceholderNote({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p className={`text-[13px] text-muted-foreground/70 ${className ?? ""}`}>
      {children}
    </p>
  )
}
