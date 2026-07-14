export type MapTheme = "light" | "dark"

const KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY

export function mapStyleUrl(theme: MapTheme): string {
  const style = theme === "dark" ? "streets-v2-dark" : "streets-v2"
  return `https://api.maptiler.com/maps/${style}/style.json?key=${KEY}`
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
