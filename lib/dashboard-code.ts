// The display code the TV exchanges for a read-only dashboard session, persisted
// so a kiosk reconnects without re-entry. It's a low-value credential (the gate's
// real secret lives server-side as DASHBOARD_DISPLAY_CODE); it's validated by
// connectDashboard before it grants entry, so a wrong code is never stored.
const KEY = "fleetmap.displayCode"

export function getDisplayCode(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(KEY)
}

export function setDisplayCode(code: string): void {
  window.localStorage.setItem(KEY, code)
}

export function clearDisplayCode(): void {
  window.localStorage.removeItem(KEY)
}
