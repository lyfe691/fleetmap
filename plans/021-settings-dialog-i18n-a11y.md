# Console Settings: Dialog + i18n + Accessibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings dialog (sidebar nav) to the monitoring console — Appearance (theme), Accessibility (4 display settings), and Language (full en + de-CH translation) — persisted per device, with the duplicated theme toggle collapsed.

**Architecture:** A `SettingsProvider` context (`lib/settings/`) owns locale + a11y flags, persists to localStorage, and reflects a11y flags as `data-*` on `<html>`. A lightweight i18n engine (`lib/i18n/`) provides `useTranslations()` over typed `en`/`de-CH` dictionaries. The dialog (`components/console/settings/`) consumes both; CSS in `globals.css` honors the a11y flags.

**Tech Stack:** Next.js 16 App Router (client console, `ssr:false`), TypeScript, `next-themes`, Tailwind v4 tokens, shadcn `dialog`, vitest.

**Spec:** `docs/specs/2026-06-29-settings-console-i18n-a11y-design.md`

## Global Constraints

- **Client-only console** (`ssr:false`): reading `localStorage`/`document` in initializers is safe and flash-free (mirror `lib/use-persisted-boolean.ts`).
- **No new runtime deps** beyond re-adding the shadcn `dialog` primitive (`pnpm dlx shadcn add dialog`). Build segmented/toggle controls from existing Tailwind tokens — do NOT re-add `switch`, `tabs`, `radio-group`, or `sidebar`.
- **Theme stays in `next-themes`** — not in the settings store. Default locale **`de-CH`**. Per-device localStorage; not synced.
- **UI matches the existing console aesthetic** — reuse the established token vocabulary (`bg-surface`/`bg-card`, `border-border`, `rounded-xl`/`rounded-2xl`, `text-muted-foreground`, `bg-primary` buttons, `size-*` touch targets). Clean, not a new visual language.
- **Key parity is type-enforced:** `de-CH` is typed `Record<TranslationKey, string>` so a missing/extra key fails `tsc`.
- **Gate per task:** `pnpm exec tsc --noEmit` + `pnpm test` pass. Tasks that add/remove files or touch CSS/the route tree also run `pnpm build` (stop the dev server first if running). Import alias `@/*` → repo root.

## File Structure

- `lib/settings/types.ts` — `Locale`, `Settings`, `DEFAULT_SETTINGS`, `SETTING_KEYS`.
- `lib/settings/storage.ts` — pure load/serialize helpers (tested).
- `lib/settings/settings-provider.tsx` — `SettingsProvider` + `useSettings()`.
- `lib/i18n/{en,de-CH,index,format}.ts` — dictionaries + `useTranslations()` + `Intl` helpers.
- `components/console/settings/{settings-dialog,appearance-section,accessibility-section,language-section,setting-row,segmented,toggle,settings-button}.tsx`.
- `components/ui/dialog.tsx` — shadcn re-add.
- Edits: `app/globals.css`, `app/dashboard/page.tsx`, `components/console/console-shell.tsx`, `components/console/app-sidebar.tsx`, `components/map/vehicle-marker.tsx`, the swept console components, `components/theme-toggle.tsx`, `CLAUDE.md`.

---

## PHASE 1 — Foundation

## Task 1: Settings store + persistence

**Files:**
- Create: `lib/settings/types.ts`, `lib/settings/storage.ts`, `lib/settings/settings-provider.tsx`, `lib/settings/storage.test.ts`
- Modify: `app/dashboard/page.tsx` (mount `SettingsProvider`)

**Interfaces:**
- Produces: `type Settings`, `DEFAULT_SETTINGS`, `loadSettings(get: (k: string) => string | null): Settings`, `<SettingsProvider>`, `useSettings(): { settings: Settings; setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void }`.

- [ ] **Step 1: Create the types**

`lib/settings/types.ts`:
```typescript
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
```

- [ ] **Step 2: Write the failing storage test**

`lib/settings/storage.test.ts`:
```typescript
import { describe, it, expect } from "vitest"
import { loadSettings, storageKey } from "@/lib/settings/storage"
import { DEFAULT_SETTINGS } from "@/lib/settings/types"

function fromMap(m: Record<string, string>) {
  return (k: string) => (k in m ? m[k] : null)
}

describe("loadSettings", () => {
  it("empty storage → defaults", () => {
    expect(loadSettings(() => null)).toEqual(DEFAULT_SETTINGS)
  })

  it("reads persisted locale + bool flags", () => {
    const get = fromMap({
      "fleetmap.settings.locale": "en",
      "fleetmap.settings.largeText": "true",
      "fleetmap.settings.highContrast": "false",
    })
    const s = loadSettings(get)
    expect(s.locale).toBe("en")
    expect(s.largeText).toBe(true)
    expect(s.highContrast).toBe(false)
    expect(s.reduceMotion).toBe(false) // unset → default
  })

  it("invalid locale → default locale", () => {
    const s = loadSettings(fromMap({ "fleetmap.settings.locale": "fr" }))
    expect(s.locale).toBe(DEFAULT_SETTINGS.locale)
  })

  it("storageKey prefixes the setting name", () => {
    expect(storageKey("locale")).toBe("fleetmap.settings.locale")
  })
})
```

- [ ] **Step 3: Run test — verify it fails**

Run: `pnpm test storage`
Expected: FAIL — `@/lib/settings/storage` has no exports yet.

- [ ] **Step 4: Implement the storage helpers**

`lib/settings/storage.ts`:
```typescript
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
```

- [ ] **Step 5: Run test — verify it passes**

Run: `pnpm test storage`
Expected: PASS (4/4).

- [ ] **Step 6: Implement the provider**

`lib/settings/settings-provider.tsx`:
```typescript
"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { BOOL_KEYS, DEFAULT_SETTINGS, type Settings } from "@/lib/settings/types"
import { loadSettings, storageKey } from "@/lib/settings/storage"

type SettingsContextValue = {
  settings: Settings
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() =>
    typeof window === "undefined"
      ? DEFAULT_SETTINGS
      : loadSettings((k) => window.localStorage.getItem(k))
  )

  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    window.localStorage.setItem(storageKey(key), String(value))
  }

  // Reflect the accessibility flags onto <html> so CSS can target them.
  useEffect(() => {
    const root = document.documentElement
    for (const key of BOOL_KEYS) {
      const attr = "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())
      if (settings[key]) root.setAttribute(attr, "true")
      else root.removeAttribute(attr)
    }
  }, [settings])

  return (
    <SettingsContext.Provider value={{ settings, setSetting }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}
```

- [ ] **Step 7: Mount the provider in the dashboard**

Read `app/dashboard/page.tsx`. Wrap the console client tree with `<SettingsProvider>` (inside the existing `ThemeProvider`, around the gate/`ConsoleShell`). Match the file's existing structure — add the import and the wrapper only.

- [ ] **Step 8: Typecheck + tests + commit**

Run: `pnpm exec tsc --noEmit` → PASS. `pnpm test` → PASS.
```bash
git add lib/settings app/dashboard/page.tsx
git commit -m "feat(settings): settings store (locale + a11y flags) with localStorage persistence"
```

---

## Task 2: Accessibility CSS + reduce-motion honored by the marker glide

**Files:**
- Modify: `app/globals.css` (4 `data-*` blocks + `--text-scale`)
- Modify: `components/map/vehicle-marker.tsx` (`useGlide` honors `data-reduce-motion`)

**Interfaces:**
- Consumes: the `data-reduce-motion` / `data-large-text` / `data-high-contrast` / `data-big-targets` attributes set by `SettingsProvider` (Task 1).

- [ ] **Step 1: Add the accessibility CSS blocks**

In `app/globals.css`, after the existing `@media (prefers-reduced-motion: reduce)` block, append:
```css
/* Accessibility settings (toggled via <html data-*> by SettingsProvider) */
html[data-reduce-motion] *,
html[data-reduce-motion] *::before,
html[data-reduce-motion] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}

html[data-large-text] {
  font-size: 112.5%; /* scales the rem-based type up ~1.125x */
}

html[data-big-targets] :is(button, [role="button"], a, input, select) {
  min-height: 2.75rem;
}

html[data-high-contrast] {
  --border: oklch(0.7 0 0);
  --muted-foreground: oklch(0.35 0 0);
}
html[data-high-contrast].dark {
  --border: oklch(1 0 0 / 35%);
  --muted-foreground: oklch(0.8 0 0);
}
```

- [ ] **Step 2: Make the marker glide honor the reduce-motion flag**

In `components/map/vehicle-marker.tsx`, the `reducedMotion()` helper currently only checks `matchMedia`. Replace it with:
```typescript
function reducedMotion(): boolean {
  if (typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-reduce-motion") === "true") {
    return true
  }
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm exec tsc --noEmit` → PASS. `pnpm test` → PASS. `pnpm build` → `✓ Compiled successfully`.
```bash
git add app/globals.css components/map/vehicle-marker.tsx
git commit -m "feat(settings): accessibility CSS (motion/text/contrast/targets) + glide honors reduce-motion"
```

---

## Task 3: Settings dialog (Appearance + Accessibility + Language) + gear entry + theme dedup

**Files:**
- Create: `components/ui/dialog.tsx` (via `pnpm dlx shadcn add dialog`)
- Create: `components/console/settings/settings-dialog.tsx`, `appearance-section.tsx`, `accessibility-section.tsx`, `language-section.tsx`, `setting-row.tsx`, `segmented.tsx`, `toggle.tsx`, `settings-button.tsx`
- Modify: `components/console/console-shell.tsx` (dialog open state), `components/console/app-sidebar.tsx` (gear button; remove bespoke `ThemeToggle`)

**Interfaces:**
- Consumes: `useSettings()` (Task 1), `useThemeToggle`/`useTheme` (`next-themes`).
- Produces: `<SettingsDialog open onOpenChange />`, `<SettingsButton onClick collapsed? />`.

> This task builds polished UI. Match the existing console aesthetic (tokens above); do not invent a new visual language. Keep each section component declarative — the shared `segmented`/`toggle`/`setting-row` helpers carry the styling.

- [ ] **Step 1: Re-add the shadcn dialog primitive**

Run: `pnpm dlx shadcn@latest add dialog`
Verify `components/ui/dialog.tsx` exists and `pnpm exec tsc --noEmit` passes. Commit nothing yet.

- [ ] **Step 2: Build the shared controls**

`components/console/settings/segmented.tsx` — a segmented control: props `{ options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }`. Render a `border-border rounded-xl` row of buttons; the active one `bg-primary text-primary-foreground`, others `text-muted-foreground`. ~40px tall (touch).

`components/console/settings/toggle.tsx` — an accessible on/off switch: props `{ checked: boolean; onChange: (v: boolean) => void; label: string }` → a `role="switch"` button with `aria-checked`, a track + knob using `bg-primary` when on, `bg-muted` when off.

`components/console/settings/setting-row.tsx` — `{ title: string; description?: string; control: ReactNode }` → a flex row, text left, control right, with bottom border.

- [ ] **Step 3: Build the three sections**

`appearance-section.tsx` — a `SettingRow` "Theme" with a `Segmented` of System / Light / Dark wired to `next-themes` (`const { theme, setTheme } = useTheme()`; value = `theme ?? "system"`).

`accessibility-section.tsx` — four `SettingRow`s (Reduce motion, Larger text, High contrast, Bigger touch targets), each with a `Toggle` wired to `settings[key]` / `setSetting(key, …)` from `useSettings()`.

`language-section.tsx` — a `SettingRow` "Language" with a `Segmented` of `English` / `Deutsch (Schweiz)` (autonyms — not translated) wired to `settings.locale` / `setSetting("locale", …)`.

- [ ] **Step 4: Build the dialog shell**

`settings-dialog.tsx` — `<Dialog open onOpenChange>` with `DialogContent` sized for the console (e.g. `max-w-2xl`, min-height). Inside: a 2-column flex — left **category rail** (`useState` active category: `"appearance" | "accessibility" | "language"`), each a button with a lucide icon (`Palette`, `Accessibility`, `Languages`) + label; right panel renders the active section. `DialogTitle` "Settings" (visually present, for a11y). Hardcode the English labels for now (Phase 2 translates them).

- [ ] **Step 5: Add the gear entry point + dialog open state**

`settings-button.tsx` — a gear (`Settings` lucide icon) button matching the sidebar footer button style (expanded + `collapsed` variants), `aria-label="Settings"`.

In `app-sidebar.tsx`: add an `onOpenSettings` prop; render `<SettingsButton>` in the footer (both expanded and collapsed layouts). **Remove the bespoke local `ThemeToggle` component and its two render sites** (the theme control now lives in the dialog). Remove now-unused `Moon`/`Sun`/`useThemeToggle` imports if they become unused.

In `console-shell.tsx`: add `const [settingsOpen, setSettingsOpen] = useState(false)`; pass `onOpenSettings={() => setSettingsOpen(true)}` to `AppSidebar`; render `<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />`.

- [ ] **Step 6: Typecheck + build + commit**

Run: `pnpm exec tsc --noEmit` → PASS (catches unused imports / missing wiring). `pnpm test` → PASS. `pnpm build` → `✓ Compiled successfully`.
```bash
git add components/ui/dialog.tsx components/console/settings app/components/console/console-shell.tsx components/console/app-sidebar.tsx components.json pnpm-lock.yaml package.json
git commit -m "feat(settings): settings dialog (appearance/accessibility/language) + gear entry, dedup theme toggle"
```
(Adjust the `git add` to exactly the files changed — `components.json`/lockfile only if `shadcn add` modified them.)

---

## PHASE 2 — Internationalization

## Task 4: i18n engine + translate the settings dialog (first consumer)

**Files:**
- Create: `lib/i18n/en.ts`, `lib/i18n/de-CH.ts`, `lib/i18n/index.ts`, `lib/i18n/format.ts`, `lib/i18n/index.test.ts`
- Modify: the four `components/console/settings/*section*.tsx` + `settings-dialog.tsx` + category rail labels to use `t()`

**Interfaces:**
- Produces: `type TranslationKey`, `useTranslations(): (key: TranslationKey, params?: Record<string, string | number>) => string`, `useLocale(): Locale`, `formatClock(ms, locale)`, `formatCount(n, locale)`.

- [ ] **Step 1: Create the en dictionary (settings strings to start)**

`lib/i18n/en.ts` — flat object, the settings surface:
```typescript
export const en = {
  "settings.title": "Settings",
  "settings.cat.appearance": "Appearance",
  "settings.cat.accessibility": "Accessibility",
  "settings.cat.language": "Language",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.a11y.reduceMotion": "Reduce motion",
  "settings.a11y.reduceMotion.desc": "Turn off marker animation and transitions",
  "settings.a11y.largeText": "Larger text",
  "settings.a11y.largeText.desc": "Increase text size across the console",
  "settings.a11y.highContrast": "High contrast",
  "settings.a11y.highContrast.desc": "Stronger borders and text",
  "settings.a11y.bigTargets": "Bigger touch targets",
  "settings.a11y.bigTargets.desc": "Larger tap areas for touch",
  "settings.language": "Language",
} as const

export type TranslationKey = keyof typeof en
```

- [ ] **Step 2: Create the de-CH dictionary (type-enforced parity)**

`lib/i18n/de-CH.ts`:
```typescript
import type { TranslationKey } from "@/lib/i18n/en"

export const deCH: Record<TranslationKey, string> = {
  "settings.title": "Einstellungen",
  "settings.cat.appearance": "Darstellung",
  "settings.cat.accessibility": "Barrierefreiheit",
  "settings.cat.language": "Sprache",
  "settings.theme": "Erscheinungsbild",
  "settings.theme.system": "System",
  "settings.theme.light": "Hell",
  "settings.theme.dark": "Dunkel",
  "settings.a11y.reduceMotion": "Animationen reduzieren",
  "settings.a11y.reduceMotion.desc": "Marker-Animation und Übergänge ausschalten",
  "settings.a11y.largeText": "Grössere Schrift",
  "settings.a11y.largeText.desc": "Schriftgrösse in der Konsole erhöhen",
  "settings.a11y.highContrast": "Hoher Kontrast",
  "settings.a11y.highContrast.desc": "Stärkere Ränder und Schrift",
  "settings.a11y.bigTargets": "Grössere Schaltflächen",
  "settings.a11y.bigTargets.desc": "Grössere Tippflächen für Touch",
  "settings.language": "Sprache",
}
```
(Note Swiss German orthography: **ß → ss** — "Grössere", "Schriftgrösse".)

- [ ] **Step 3: Write the failing engine test**

`lib/i18n/index.test.ts`:
```typescript
import { describe, it, expect } from "vitest"
import { en } from "@/lib/i18n/en"
import { deCH } from "@/lib/i18n/de-CH"
import { translate } from "@/lib/i18n/index"

describe("dictionary parity", () => {
  it("de-CH has exactly the en keys, all non-empty", () => {
    expect(Object.keys(deCH).sort()).toEqual(Object.keys(en).sort())
    for (const v of Object.values(deCH)) expect(v.length).toBeGreaterThan(0)
    for (const v of Object.values(en)) expect(v.length).toBeGreaterThan(0)
  })
})

describe("translate", () => {
  it("returns the locale string", () => {
    expect(translate("de-CH", "settings.title")).toBe("Einstellungen")
    expect(translate("en", "settings.title")).toBe("Settings")
  })
  it("interpolates {params}", () => {
    // uses a runtime key; cast through unknown for the test fixture
    const out = translate("en", "settings.title", { unused: 1 })
    expect(out).toBe("Settings")
  })
})
```

- [ ] **Step 4: Run test — verify it fails**

Run: `pnpm test i18n`
Expected: FAIL — `@/lib/i18n/index` has no `translate` export.

- [ ] **Step 5: Implement the engine**

`lib/i18n/index.ts`:
```typescript
import { useSettings } from "@/lib/settings/settings-provider"
import type { Locale } from "@/lib/settings/types"
import { en, type TranslationKey } from "@/lib/i18n/en"
import { deCH } from "@/lib/i18n/de-CH"

const DICTS: Record<Locale, Record<TranslationKey, string>> = { en, "de-CH": deCH }

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  let s = DICTS[locale][key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll("{" + k + "}", String(v))
    }
  }
  return s
}

export function useTranslations() {
  const { settings } = useSettings()
  return (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(settings.locale, key, params)
}

export function useLocale(): Locale {
  return useSettings().settings.locale
}
```

`lib/i18n/format.ts`:
```typescript
import type { Locale } from "@/lib/settings/types"

const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", "de-CH": "de-CH" }

export function formatClock(ms: number, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms))
}

export function formatCount(n: number, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(n)
}
```

- [ ] **Step 6: Run test — verify it passes**

Run: `pnpm test i18n`
Expected: PASS.

- [ ] **Step 7: Translate the settings dialog (first real consumer)**

In each `components/console/settings/*` component, replace the hardcoded English labels from Task 3 with `const t = useTranslations()` + `t("settings...")`. The Appearance segmented uses `t("settings.theme.system|light|dark")`; the category rail uses `t("settings.cat.*")`; the dialog title `t("settings.title")`; accessibility rows `t("settings.a11y.*")` (+ `.desc`). The Language autonyms (`English` / `Deutsch (Schweiz)`) stay literal.

- [ ] **Step 8: Typecheck + tests + build + commit**

Run: `pnpm exec tsc --noEmit` → PASS (parity enforced). `pnpm test` → PASS. `pnpm build` → ✓.
```bash
git add lib/i18n components/console/settings
git commit -m "feat(i18n): translation engine (en/de-CH) + translate the settings dialog"
```

---

## Task 5: String sweep — sidebar, shell, loading, display gate

**Files:**
- Modify: `lib/i18n/en.ts` + `lib/i18n/de-CH.ts` (add the keys for this group)
- Modify: `components/console/app-sidebar.tsx`, `components/console/console-shell.tsx`, `components/console/console-loading.tsx`, `components/map/dashboard-gate.tsx`, `components/map/dashboard-code-screen.tsx`

**Procedure (repeat per file):**

- [ ] **Step 1: Extract every user-facing string** in the five components above (nav labels "Live Tracking"/"Live Map"/"History", group headings "Monitor"/"Records", "Fleetmap"/"Monitoring Console", "{online} of {total} online", "Settings", "Expand/Collapse sidebar" aria-labels, the display-code gate prompt + button + error copy, the loading text). For each, add an `en` key (reuse the dotted-area convention, e.g. `nav.tracking`, `sidebar.online`, `gate.prompt`) and its `de-CH` Swiss-German translation. Keep `{param}` tokens for dynamic values; format counts/clock via `formatCount`/`formatClock` with `useLocale()`.

- [ ] **Step 2: Replace** each string with `t("key")` (or `t("key", { … })`). Add `const t = useTranslations()` to each component. The online-count line becomes `t("sidebar.online", { online: formatCount(online, locale), total: formatCount(total, locale) })`; the clock uses `formatClock(now, locale)`.

- [ ] **Step 3: Verify + commit**

Run: `pnpm exec tsc --noEmit` → PASS (parity). `pnpm test` → PASS (the parity test covers the new keys). `pnpm build` → ✓.
```bash
git add lib/i18n components/console/app-sidebar.tsx components/console/console-shell.tsx components/console/console-loading.tsx components/map/dashboard-gate.tsx components/map/dashboard-code-screen.tsx
git commit -m "feat(i18n): translate sidebar, shell, loading, display gate"
```

---

## Task 6: String sweep — fleet rail, map summary card, status badge, placeholder note

**Files:**
- Modify: `lib/i18n/en.ts` + `lib/i18n/de-CH.ts`
- Modify: `components/console/fleet-rail.tsx`, `components/console/map-view.tsx`, `components/console/status-badge.tsx`, `components/console/placeholder-note.tsx`

- [ ] **Step 1: Extract + translate** the strings in these four: the rail header ("Fleet", "{n} vehicles"), the status-filter segments ("All"/"On Route"/"Waiting" + counts), per-card text ("Idle", "{n} stop(s) left" with plural handling, "Awaiting dispatch", "{n} stops left", origin→dest labels), the map summary card (reg/speed labels, "Speed"/"ETA"/"Load", "View Vehicle Details", "stale"), status-badge labels (the rendered `statusLabel` — translate at the source in `use-console-data` OR map `tone`→key in the badge; prefer translating where the label is produced — note: `use-console-data.ts` sets `statusLabel`; translating there needs the locale, so instead map `tone` → `t()` in `StatusBadge`), the placeholder-note text. Plurals: add separate keys (`rail.stopsLeft.one`/`rail.stopsLeft.other`) and pick by `n === 1`.

- [ ] **Step 2: Replace** with `t()`. For `StatusBadge`, render `t(tone === "onRoute" ? "status.onRoute" : "status.waiting")` instead of the passed `label` (or keep `label` but pass a translated value — choose the path that keeps `use-console-data` locale-free; document the choice in the commit).

- [ ] **Step 3: Verify + commit**

Run: `pnpm exec tsc --noEmit` → PASS. `pnpm test` → PASS. `pnpm build` → ✓.
```bash
git add lib/i18n components/console/fleet-rail.tsx components/console/map-view.tsx components/console/status-badge.tsx components/console/placeholder-note.tsx
git commit -m "feat(i18n): translate fleet rail, map summary card, status badge"
```

---

## Task 7: String sweep — tracking + history views; docs

**Files:**
- Modify: `lib/i18n/en.ts` + `lib/i18n/de-CH.ts`
- Modify: `components/console/tracking-view.tsx`, `components/console/history-view.tsx`
- Modify: `CLAUDE.md` (layout + a settings/i18n convention note)

- [ ] **Step 1: Extract + translate** all strings in `tracking-view.tsx` (detail tabs "Overview"/"Vehicle"/"Cargo", field labels, "Route Progress", section headings, any button/empty-state copy) and `history-view.tsx` (column headers, status labels "Delivered"/"Delayed", any empty state). Add keys + Swiss-German. Use plurals/params/format helpers as in Tasks 5–6.

- [ ] **Step 2: Replace** with `t()`.

- [ ] **Step 3: Update `CLAUDE.md`** — add to the layout: `lib/settings/` (settings store), `lib/i18n/` (en/de-CH translation engine), `components/console/settings/` (settings dialog). Add a one-line convention: settings are per-device localStorage; a11y flags ride `<html data-*>` + CSS; all console chrome goes through `useTranslations()` with type-enforced de-CH parity.

- [ ] **Step 4: Final verify + commit**

Run: `pnpm exec tsc --noEmit` → PASS. `pnpm test` → PASS. `pnpm build` → ✓ (all routes compile).
```bash
git add lib/i18n components/console/tracking-view.tsx components/console/history-view.tsx CLAUDE.md
git commit -m "feat(i18n): translate tracking + history views; docs"
```

---

## Self-Review

**Spec coverage:**
- Settings store (locale + 4 a11y flags, localStorage, data-*) → Task 1. ✅
- Accessibility CSS for all four flags + reduce-motion in glide → Task 2. ✅
- Dialog with category rail + Appearance (System/Light/Dark) + Accessibility + Language; gear entry; theme dedup → Task 3. ✅
- i18n engine (typed parity, interpolation, Intl formatting, default de-CH) → Task 4. ✅
- Full string sweep across all console surfaces → Tasks 4–7. ✅
- Tests: storage, interpolation, parity → Tasks 1, 4. ✅
- Docs → Task 7. ✅
- No new heavy deps; only `dialog` re-added → Task 3 constraint. ✅

**Placeholder scan:** Logic tasks (1, 4) carry complete code + tests. UI (Task 3) and the sweep (5–7) are necessarily discovery+transcription tasks with a precise procedure and a hard gate (`tsc` parity + parity test + `build`); the exact strings are enumerated from the named files during implementation — this is inherent to a translation sweep, not an omission.

**Type consistency:** `Settings`/`loadSettings`/`setSetting` signatures match across Tasks 1–4. `TranslationKey` from `en.ts` types `de-CH` and `translate`/`useTranslations` (Task 4), consumed by the sweep (5–7). `useSettings` (Task 1) feeds both `useTranslations` (Task 4) and the a11y dataset (Task 1/2 attributes ↔ Task 2 CSS selectors: `reduceMotion`→`data-reduce-motion`, `largeText`→`data-large-text`, `highContrast`→`data-high-contrast`, `bigTargets`→`data-big-targets`).
