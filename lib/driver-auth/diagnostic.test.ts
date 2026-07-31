import { describe, expect, it } from "vitest"
import { summarizeExchangeBody } from "./diagnostic"

describe("summarizeExchangeBody", () => {
  it("reports session field presence without returning token values", () => {
    const summary = summarizeExchangeBody(
      200,
      JSON.stringify({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        expires_in: 3600,
      })
    )
    const rendered = JSON.stringify(summary)
    expect(summary).toEqual({
      status: 200,
      session: {
        access_token: "present",
        refresh_token: "present",
        expires_in: 3600,
      },
    })
    expect(rendered).not.toContain("access-secret")
    expect(rendered).not.toContain("refresh-secret")
  })

  it("reports missing session fields for a malformed success body", () => {
    expect(summarizeExchangeBody(200, "submitted-secret")).toEqual({
      status: 200,
      session: {
        access_token: "missing",
        refresh_token: "missing",
        expires_in: null,
      },
    })
  })

  it.each([
    [400, "malformed request"],
    [401, "invalid token"],
    [403, "unmapped rider"],
    [413, "body too large"],
    [500, "exchange failed"],
    [418, "unexpected response"],
  ] as const)(
    "classifies status %i without trusting server text",
    (status, error) => {
      const summary = summarizeExchangeBody(
        status,
        JSON.stringify({
          error: "invalid token: submitted-secret",
          token: "submitted-secret",
        })
      )

      expect(summary).toEqual({ status, error })
      expect(JSON.stringify(summary)).not.toContain("submitted-secret")
    }
  )
})
