import { describe, it, expect } from "vitest"
import { matchesStatusFilter } from "@/lib/console/types"

describe("matchesStatusFilter", () => {
  it('"All" returns true for tone onRoute', () => {
    expect(matchesStatusFilter({ tone: "onRoute" }, "All")).toBe(true)
  })

  it('"All" returns true for tone waiting', () => {
    expect(matchesStatusFilter({ tone: "waiting" }, "All")).toBe(true)
  })

  it('"On Route" returns true only for tone onRoute', () => {
    expect(matchesStatusFilter({ tone: "onRoute" }, "On Route")).toBe(true)
    expect(matchesStatusFilter({ tone: "waiting" }, "On Route")).toBe(false)
  })

  it('"Waiting" returns true only for tone waiting', () => {
    expect(matchesStatusFilter({ tone: "waiting" }, "Waiting")).toBe(true)
    expect(matchesStatusFilter({ tone: "onRoute" }, "Waiting")).toBe(false)
  })
})
