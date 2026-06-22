"use client"

import { useEffect, useState } from "react"

// Boolean state mirrored to localStorage (client-only — the console mounts with
// ssr:false, so reading storage in the initializer is safe and flash-free).
export function usePersistedBoolean(key: string, initial: boolean) {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return initial
    const stored = window.localStorage.getItem(key)
    return stored == null ? initial : stored === "true"
  })

  useEffect(() => {
    window.localStorage.setItem(key, String(value))
  }, [key, value])

  return [value, setValue] as const
}
