export type MapTheme = "light" | "dark"

// OpenFreeMap: free public tiles, no API key, no request limits (donation-
// funded; commercial use allowed; MapLibre adds the attribution control).
// liberty = maintained light street style; fiord = the readable dark style
// (their "dark" is a Dark Matter fork — a near-black dataviz basemap where
// streets are barely visible on a TV).
export function mapStyleUrl(theme: MapTheme): string {
  const style = theme === "dark" ? "fiord" : "liberty"
  return `https://tiles.openfreemap.org/styles/${style}`
}

// MapLibre paint needs concrete colors (it can't read CSS vars); mirrors the
// globals.css tokens per theme.
type MapColors = {
  route: string
  routeLate: string // remaining line when the van is behind schedule
  routeCasing: string
  traveled: string
  pickup: string
  dropoff: string
  stopDone: string // de-emphasised fill for completed stop markers
  vehicleOnRoute: string
  vehicleWaiting: string
  vehicleStale: string
  markerStroke: string
}

export function mapColors(theme: MapTheme): MapColors {
  if (theme === "dark") {
    return {
      // Remaining route is the brand teal (lifted for dark tiles); the traveled
      // portion stays neutral grey so progress still reads as colour → grey.
      route: "#34d3df",
      routeLate: "#f87171",
      routeCasing: "#34343a",
      traveled: "#8f8f93",
      pickup: "#34d399",
      dropoff: "#cbd5e1",
      stopDone: "#6b6b70",
      vehicleOnRoute: "#34d399",
      vehicleWaiting: "#fbbf24",
      vehicleStale: "#8f8f93",
      markerStroke: "#34343a",
    }
  }
  return {
    route: "#1bbecd",
    routeLate: "#dc2626",
    routeCasing: "#ffffff",
    traveled: "#9a9a9f",
    pickup: "#16a34a",
    dropoff: "#475569",
    stopDone: "#a8a8ad",
    vehicleOnRoute: "#16a34a",
    vehicleWaiting: "#d97706",
    vehicleStale: "#9ca3af",
    markerStroke: "#ffffff",
  }
}
