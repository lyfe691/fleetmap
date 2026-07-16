import { describe, it, expect } from "vitest"
import { matchesStatusFilter } from "@/lib/console/types"

describe("matchesStatusFilter", () => {
  it('"All" returns true for tone onRoute', () => {
    expect(matchesStatusFilter({ tone: "onRoute", late: false }, "All")).toBe(
      true
    )
  })

  it('"All" returns true for tone waiting', () => {
    expect(matchesStatusFilter({ tone: "waiting", late: false }, "All")).toBe(
      true
    )
  })

  it('"On Route" returns true only for tone onRoute', () => {
    expect(
      matchesStatusFilter({ tone: "onRoute", late: false }, "On Route")
    ).toBe(true)
    expect(
      matchesStatusFilter({ tone: "waiting", late: false }, "On Route")
    ).toBe(false)
  })

  it('"Waiting" returns true only for tone waiting', () => {
    expect(
      matchesStatusFilter({ tone: "waiting", late: false }, "Waiting")
    ).toBe(true)
    expect(
      matchesStatusFilter({ tone: "onRoute", late: false }, "Waiting")
    ).toBe(false)
  })

  it('"Late" returns true only when late, regardless of tone', () => {
    expect(matchesStatusFilter({ tone: "onRoute", late: true }, "Late")).toBe(
      true
    )
    expect(matchesStatusFilter({ tone: "waiting", late: true }, "Late")).toBe(
      true
    )
    expect(matchesStatusFilter({ tone: "onRoute", late: false }, "Late")).toBe(
      false
    )
  })
})
