export type MapTheme = "light" | "dark"

// Free, keyless, no-request-limit tiles from two community hosts (both must
// stay in next.config.ts's CSP):
// - light: OpenFreeMap "liberty" — the maintained light street style.
// - dark: VersaTiles "eclipse" — a readable dark STREET style (dark variant
//   of their colorful). OpenFreeMap's dark styles lost: "dark" is a
//   near-black dataviz basemap, "fiord" still too dim for the TV.
export function mapStyleUrl(theme: MapTheme): string {
  return theme === "dark"
    ? "https://tiles.versatiles.org/assets/styles/eclipse/style.json"
    : "https://tiles.openfreemap.org/styles/liberty"
}

// MapLibre paint needs concrete colors (it can't read CSS vars); mirrors the
// globals.css tokens per theme.
type MapColors = {
  route: string
  routeLate: string // remaining line when the van is behind schedule
  routeCasing: string
  traveled: string
  pickup: string // dispatch pin-map + history replay start dot
  dropoff: string // history replay end dot
  // Focus-mode stop badges. Pre-mixed solid colours at full element opacity —
  // an opacity fade over light tiles would fail number contrast. stopNextText
  // also passes on the late-red fill in both themes (white on light-theme
  // red, near-black on dark-theme red).
  stopDoneFill: string
  stopDoneText: string
  stopNextFill: string
  stopNextText: string
  stopUpcomingText: string // on a markerStroke-filled badge
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
      stopDoneFill: "#3f3f46",
      stopDoneText: "#a1a1aa",
      stopNextFill: "#34d3df",
      stopNextText: "#0c1417",
      stopUpcomingText: "#e4e4e7",
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
    stopDoneFill: "#e4e4e7",
    stopDoneText: "#52525b",
    // Deeper than the route teal so the white number passes contrast; reads
    // as a deliberate accent of the same family.
    stopNextFill: "#0f766e",
    stopNextText: "#ffffff",
    stopUpcomingText: "#27272a",
    vehicleOnRoute: "#16a34a",
    vehicleWaiting: "#d97706",
    vehicleStale: "#9ca3af",
    markerStroke: "#ffffff",
  }
}
