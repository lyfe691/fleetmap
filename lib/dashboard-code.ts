// The display code the TV exchanges for a read-only dashboard session. Kept in
// localStorage so it stays out of the JS bundle (the gate's real secret lives
// server-side as DASHBOARD_DISPLAY_CODE). Exposed as a tiny external store so the
// dashboard gate can read it via useSyncExternalStore (SSR-safe, no effect).
const KEY = "fleetmap.displayCode"
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function getDisplayCode(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(KEY)
}

export function setDisplayCode(code: string): void {
  window.localStorage.setItem(KEY, code)
  notify()
}

export function clearDisplayCode(): void {
  window.localStorage.removeItem(KEY)
  notify()
}

// Only ever called client-side (by useSyncExternalStore after hydration).
export function subscribeDisplayCode(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}
