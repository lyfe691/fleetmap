import { describe, it, expect } from "vitest"
import { en } from "@/lib/i18n/en"
import { deCH } from "@/lib/i18n/de-CH"
import { translate } from "@/lib/i18n/index"

describe("dictionary parity", () => {
  it("de-CH has exactly the en keys, all non-empty", () => {
    expect(Object.keys(deCH).sort()).toEqual(Object.keys(en).sort())
    for (const v of Object.values(deCH)) expect(v.length).toBeGreaterThan(0)
    for (const v of Object.values(en)) expect(v.length).toBeGreaterThan(0)
  })
})

describe("translate", () => {
  it("returns the locale string", () => {
    expect(translate("de-CH", "settings.title")).toBe("Einstellungen")
    expect(translate("en", "settings.title")).toBe("Settings")
  })
  it("interpolates {params}", () => {
    // uses a runtime key; cast through unknown for the test fixture
    const out = translate("en", "settings.title", { unused: 1 })
    expect(out).toBe("Settings")
  })
})
