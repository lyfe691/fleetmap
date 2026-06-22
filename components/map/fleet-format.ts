import type { Stop } from "@/lib/use-live-stops"

export function isActive(s: Stop): boolean {
  return s.status === "planned" || s.status === "arrived"
}
