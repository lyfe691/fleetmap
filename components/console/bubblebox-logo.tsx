// Bubblebox mark: a broken progress ring (theme foreground) with a teal check
// breaking out the top-right. Recreated as SVG so it stays crisp and adapts to
// light/dark; swap for the official asset if a clean SVG/transparent PNG exists.
export function BubbleboxLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M19.6 10.2 A8 8 0 1 1 13.6 4.3"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M7.4 12.4 L10.9 15.9 L20 4.5"
        stroke="#1bbecd"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
