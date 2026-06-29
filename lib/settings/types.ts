export type Locale = "en" | "de-CH"

export type Settings = {
  locale: Locale
  reduceMotion: boolean
  largeText: boolean
  highContrast: boolean
  bigTargets: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  locale: "de-CH",
  reduceMotion: false,
  largeText: false,
  highContrast: false,
  bigTargets: false,
}

export const BOOL_KEYS = [
  "reduceMotion",
  "largeText",
  "highContrast",
  "bigTargets",
] as const satisfies readonly (keyof Settings)[]

export const STORAGE_PREFIX = "fleetmap.settings."
