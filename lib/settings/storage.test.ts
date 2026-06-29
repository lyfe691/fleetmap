import { describe, it, expect } from "vitest"
import { loadSettings, storageKey } from "@/lib/settings/storage"
import { DEFAULT_SETTINGS } from "@/lib/settings/types"

function fromMap(m: Record<string, string>) {
  return (k: string) => (k in m ? m[k] : null)
}

describe("loadSettings", () => {
  it("empty storage → defaults", () => {
    expect(loadSettings(() => null)).toEqual(DEFAULT_SETTINGS)
  })

  it("reads persisted locale + bool flags", () => {
    const get = fromMap({
      "fleetmap.settings.locale": "en",
      "fleetmap.settings.reduceMotion": "true",
    })
    const s = loadSettings(get)
    expect(s.locale).toBe("en")
    expect(s.reduceMotion).toBe(true)
    expect(s.highContrast).toBe(false) // unset → default
  })

  it("invalid locale → default locale", () => {
    const s = loadSettings(fromMap({ "fleetmap.settings.locale": "fr" }))
    expect(s.locale).toBe(DEFAULT_SETTINGS.locale)
  })

  it("storageKey prefixes the setting name", () => {
    expect(storageKey("locale")).toBe("fleetmap.settings.locale")
  })
})
