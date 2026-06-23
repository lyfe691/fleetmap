// @vitest-environment node
import { describe, it, expect } from "vitest"
import { syncBlockedMessage } from "@/lib/driver-status"

describe("syncBlockedMessage", () => {
  it("returns storage message when syncError is 'storage'", () => {
    expect(
      syncBlockedMessage({ geoSupported: true, geoError: null, syncError: "storage" })
    ).toBe(
      "Storage error — fixes can't be saved on this device. Try another browser or disable private mode."
    )
  })

  it("returns no-vehicle message when syncError is 'no-vehicle'", () => {
    expect(
      syncBlockedMessage({ geoSupported: true, geoError: null, syncError: "no-vehicle" })
    ).toBe("No vehicle is assigned to this account.")
  })

  it("returns auth message when syncError is 'auth'", () => {
    expect(
      syncBlockedMessage({ geoSupported: true, geoError: null, syncError: "auth" })
    ).toBe("Session expired — sign out and back in.")
  })

  it("returns null when no error", () => {
    expect(
      syncBlockedMessage({ geoSupported: true, geoError: null, syncError: null })
    ).toBeNull()
  })

  it("returns no-geolocation message when geoSupported is false", () => {
    expect(
      syncBlockedMessage({ geoSupported: false, geoError: null, syncError: null })
    ).toBe("This device has no geolocation.")
  })

  it("returns denied message when geoError is 'denied'", () => {
    expect(
      syncBlockedMessage({ geoSupported: true, geoError: "denied", syncError: null })
    ).toBe("Location permission denied — enable location for this site.")
  })

  it("geo errors take priority over sync errors", () => {
    // geoSupported=false beats any sync error
    expect(
      syncBlockedMessage({ geoSupported: false, geoError: null, syncError: "storage" })
    ).toBe("This device has no geolocation.")
  })
})
