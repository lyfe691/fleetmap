// Placeholder van line-art (single fleet model), ported from the handoff.

export function VanGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 108 60"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 46 L6 19 Q6 16 9 16 L74 16 Q80 16 84 20 L98 33 Q101 36 101 40 L101 46 Z" />
      <path d="M70 21 H82 L89 30 H70 Z" />
      <path d="M54 16 V46" />
      <path d="M9 39 H64" />
      <circle cx="30" cy="48" r="6.5" />
      <circle cx="82" cy="48" r="6.5" />
    </svg>
  )
}

export function VanCapacityGauge({
  pct,
  className,
}: {
  pct: number
  className?: string
}) {
  const fillW = Math.round(62 * (Math.max(0, Math.min(100, pct)) / 100))
  return (
    <svg viewBox="0 0 150 60" fill="none" className={className} aria-hidden>
      {fillW > 0 ? (
        <rect x={11} y={19} width={fillW} height={26} rx={2} className="fill-primary" />
      ) : null}
      <g
        className="stroke-foreground"
        fill="none"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 47 L8 18 Q8 14 13 14 L104 14 Q112 14 117 19 L138 33 Q142 37 142 42 L142 47 Z" />
        <path d="M98 19 H114 L124 31 H98 Z" />
        <path d="M76 14 V47" />
        <circle cx="44" cy="49" r="9" />
        <circle cx="116" cy="49" r="9" />
      </g>
    </svg>
  )
}
