"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { BOOL_KEYS, DEFAULT_SETTINGS, type Settings } from "@/lib/settings/types"
import { loadSettings, storageKey } from "@/lib/settings/storage"

type SettingsContextValue = {
  settings: Settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  // Load stored settings after mount so server and first client render are
  // identical (both use DEFAULT_SETTINGS), eliminating the hydration mismatch.
  useEffect(() => {
    const stored = loadSettings((k) => window.localStorage.getItem(k))
    setSettings(stored)
  }, [])

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (typeof window !== "undefined") window.localStorage.setItem(storageKey(key), String(value))
  }

  useEffect(() => {
    const root = document.documentElement
    const attrs: string[] = []
    for (const key of BOOL_KEYS) {
      const attr = "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
      attrs.push(attr)
      if (settings[key]) root.setAttribute(attr, "true")
      else root.removeAttribute(attr)
    }
    return () => {
      for (const attr of attrs) root.removeAttribute(attr)
    }
  }, [settings])

  return (
    <SettingsContext.Provider value={{ settings, setSetting }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}
