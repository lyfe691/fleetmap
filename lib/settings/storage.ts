import {
  BOOL_KEYS,
  DEFAULT_SETTINGS,
  STORAGE_PREFIX,
  type Locale,
  type Settings,
} from "@/lib/settings/types"

export function storageKey(key: keyof Settings): string {
  return STORAGE_PREFIX + key
}

function asLocale(v: string | null): Locale {
  return v === "en" || v === "de-CH" ? v : DEFAULT_SETTINGS.locale
}

export function loadSettings(get: (k: string) => string | null): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS }
  settings.locale = asLocale(get(storageKey("locale")))
  for (const key of BOOL_KEYS) {
    const raw = get(storageKey(key))
    if (raw != null) settings[key] = raw === "true"
  }
  return settings
}
