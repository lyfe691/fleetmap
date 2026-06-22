import type { Stop } from "@/lib/use-live-stops"

export function isActive(s: Stop): boolean {
  return s.status === "planned" || s.status === "arrived"
}

export function formatEta(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 1) return "<1 min"
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
