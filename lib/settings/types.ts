export type Locale = "en" | "de-CH"

export type Settings = {
  locale: Locale
  reduceMotion: boolean
  highContrast: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  locale: "de-CH",
  reduceMotion: false,
  highContrast: false,
}

export const BOOL_KEYS = [
  "reduceMotion",
  "highContrast",
] as const satisfies readonly (keyof Settings)[]

export const STORAGE_PREFIX = "fleetmap.settings."
