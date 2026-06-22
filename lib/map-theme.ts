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
  routeCasing: string
  traveled: string
  pickup: string
  dropoff: string
  vehicleOnRoute: string
  vehicleWaiting: string
  vehicleStale: string
  markerStroke: string
}

export function mapColors(theme: MapTheme): MapColors {
  if (theme === "dark") {
    return {
      route: "#ededed",
      routeCasing: "#34343a",
      traveled: "#8f8f93",
      pickup: "#34d399",
      dropoff: "#818cf8",
      vehicleOnRoute: "#34d399",
      vehicleWaiting: "#fbbf24",
      vehicleStale: "#8f8f93",
      markerStroke: "#34343a",
    }
  }
  return {
    route: "#1f1f23",
    routeCasing: "#ffffff",
    traveled: "#9a9a9f",
    pickup: "#16a34a",
    dropoff: "#6366f1",
    vehicleOnRoute: "#16a34a",
    vehicleWaiting: "#d97706",
    vehicleStale: "#9ca3af",
    markerStroke: "#ffffff",
  }
}
