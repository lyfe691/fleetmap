# Dashboard settings: dialog + i18n (en / de-CH) + accessibility

**Status:** design · 2026-06-29
**Topic:** a clean settings dialog (sidebar nav) inside the monitoring console — Appearance (theme), Accessibility (4 display settings), and Language (en + de-CH, full UI translation).

## Goal

Give the wall-mounted console a single **Settings** dialog with a category sidebar, exposing:
- **Appearance** — the theme control (moved here from the sidebar), as System / Light / Dark.
- **Accessibility** — reduce motion, larger text, high contrast, bigger touch targets.
- **Language** — English and **Deutsch (Schweiz)**, switching *all* visible UI text.

Preferences persist per device (`localStorage`). Code and UI both clean; the existing duplicated theme-toggle is collapsed in the process.

## Architecture — four units

1. **`lib/settings/` — the settings store.** A `SettingsProvider` (React context) owns `locale` + the four a11y booleans, hydrated from `localStorage` in the initializer (the console is `ssr:false`, so this is flash-free — same pattern as `lib/use-persisted-boolean.ts`). It persists each change and applies the a11y flags as `data-*` attributes on `document.documentElement`. Theme is **not** in this store — `next-themes` keeps owning it.
2. **`lib/i18n/` — the translation engine.** A typed dictionary + a `useTranslations()` hook reading the locale from the settings store.
3. **`components/console/settings/` — the dialog UI.** The shadcn `dialog` primitive (re-added) wrapping a category rail + a content panel; three section components; a gear entry point in the app sidebar.
4. **`app/globals.css` — the accessibility CSS.** One rule block per `data-*` flag.

These are independently understandable and testable: the store has no UI, the i18n engine has no UI, the dialog consumes both.

## Unit 1 — settings store (`lib/settings/`)

```ts
// lib/settings/types.ts
export type Locale = "en" | "de-CH"
export type Settings = {
  locale: Locale
  reduceMotion: boolean
  largeText: boolean
  highContrast: boolean
  bigTargets: boolean
}
export const DEFAULT_SETTINGS: Settings = {
  locale: "de-CH",          // Swiss office TV; one line to flip to "en"
  reduceMotion: false,
  largeText: false,
  highContrast: false,
  bigTargets: false,
}
```

- `lib/settings/settings-provider.tsx` — `SettingsProvider` + `useSettings()`. Initializer reads each key from `localStorage` (`fleetmap.settings.<key>`), falling back to `DEFAULT_SETTINGS`. Exposes `{ settings, setSetting<K>(key, value) }`.
- One `useEffect` per render writes changed values to `localStorage` and reflects the a11y flags onto `document.documentElement.dataset` (`reduceMotion`, `largeText`, `highContrast`, `bigTargets` → `data-reduce-motion` etc.). Locale is **not** a dataset flag (it drives `t()`, not CSS).
- Mounted in `app/dashboard/page.tsx`'s client tree, wrapping `ConsoleShell` (inside the existing `ThemeProvider`).

## Unit 2 — i18n engine (`lib/i18n/`)

- `lib/i18n/en.ts` — the **source-of-truth** dictionary: a flat object of `key → string`, grouped by area via dotted keys (`"nav.tracking"`, `"card.viewDetails"`, `"rail.stopsLeft"`, `"settings.title"`, …). Export `type TranslationKey = keyof typeof en`.
- `lib/i18n/de-CH.ts` — `const deCH: Record<TranslationKey, string> = { … }`. The `Record<TranslationKey, …>` type makes a **missing or extra key a compile error** — key parity is guaranteed by the type system, not vigilance.
- `lib/i18n/index.ts` — `useTranslations()` returns `t(key: TranslationKey, params?: Record<string, string | number>) => string`. Interpolation replaces `{name}` tokens. Locale comes from `useSettings()`. Also exports `useLocale()` for `Intl` formatting.
- **Formatting:** time/number formatting that varies by locale (the sidebar clock, ETA minutes, counts) uses `Intl.DateTimeFormat`/`NumberFormat` with the active locale. `"de-CH"` for German, `"en-GB"` for English (24h clock, sensible for a European fleet). A tiny `lib/i18n/format.ts` helper centralizes this.

## Unit 3 — the settings dialog (`components/console/settings/`)

- Re-add **only** `dialog` via `pnpm dlx shadcn add dialog` (the cleanup removed it; the heavy `sidebar` primitive is **not** re-added — overkill inside a modal).
- `settings-dialog.tsx` — controlled `Dialog`. Body is a 2-column layout: a left **category rail** (Appearance · Accessibility · Language, each a button with icon + label) and a right panel that renders the selected section. Local `useState` for the active category. Touch-friendly sizing.
- `appearance-section.tsx` — a **System / Light / Dark** segmented control driving `next-themes` (`setTheme`), built from buttons (no new primitive). Uses the retained `useThemeToggle`/`useTheme`.
- `accessibility-section.tsx` — four rows: Reduce motion, Larger text, High contrast, Bigger touch targets — each a labeled toggle wired to `setSetting`. (Toggles built from a small local `Toggle` on existing tokens; no shadcn `switch` re-add.)
- `language-section.tsx` — English / Deutsch (Schweiz) selector (segmented), wired to `setSetting("locale", …)`.
- `setting-row.tsx` + a `segmented.tsx`/`toggle.tsx` helper — shared presentational pieces so the sections stay declarative.
- **Entry point:** a gear `SettingsButton` in the app-sidebar footer (expanded + collapsed variants), opening the dialog. State lifted into `ConsoleShell` (or local to the sidebar).

## Unit 4 — accessibility CSS (`app/globals.css`)

One block per flag, all theme-token-based so they compose with light/dark:
- `html[data-reduce-motion] *` — `animation`/`transition` reduced to ~0 (same shape as the existing `prefers-reduced-motion` block; this is the explicit, always-on version). The marker glide already checks `prefers-reduced-motion`; it will also honor this flag via a matchMedia-independent path (the store sets the attribute; the glide reads it — small addition to `useGlide`).
- `html[data-large-text]` — sets a root `--text-scale` (e.g. `1.15`) consumed by a base `font-size`, scaling the rem-based type up.
- `html[data-high-contrast]` — overrides a handful of tokens (`--border`, `--muted-foreground`, `--foreground`) to higher-contrast values, in both `:root` and `.dark`. Strengthens borders/secondary text for glare/low-vision.
- `html[data-big-targets]` — raises min hit-area on interactive controls (a `min-h`/`min-w` rule scoped to buttons/links within the console) for touch.

## The string sweep (full translation)

Replace every user-facing string in the console with `t("…")`, building `en` + `de-CH`:
- **Components:** `components/console/{app-sidebar,fleet-rail,map-view,tracking-view,history-view,console-shell,console-loading,status-badge,placeholder-note}.tsx`, `components/map/{dashboard-gate,dashboard-code-screen}.tsx`, and the settings dialog itself.
- **Dynamic strings** get params: `"{online} of {total} online"`, `"{n} stops left"`, ETA (`"{m} min"`, `"{h} h {m} min"`), status labels (`"On Route"` / `"Waiting"` → `t`), filter labels (`All/On Route/Waiting`), section headings, button labels, empty states, the display-code gate copy.
- **Not translated:** demo/placeholder *data values* from `lib/console/assumed.ts` (driver names, plate numbers, model) — these are fake telematics, not chrome. The `*` placeholder marker stays.
- `status-badge`/console keep their `onRoute`/`waiting` tone vocabulary; only the **rendered label** is translated.

## Cleanup (clean code)

- The theme toggle is duplicated today: `components/theme-toggle.tsx` (exports `ThemeToggle` + `useThemeToggle`) **and** a second bespoke `ThemeToggle` inside `app-sidebar.tsx`. Collapse it: keep the `useThemeToggle` hook (Appearance section uses it), **delete** the sidebar's bespoke toggle, and remove `ThemeToggle`'s standalone button export if it ends up unused. The sidebar footer loses the toggle and gains the gear.
- The `d` theme hotkey stays in `theme-provider.tsx` (power users).

## Decisions (baked in, confirmed)

- **Default locale: de-CH.** Per-device preference; English fully available.
- **Theme: System / Light / Dark** segmented control (next-themes already supports all three) — not a 2-way toggle.
- **Per-device settings** via `localStorage`; not synced across screens (display preference, not fleet data).
- Re-add only the `dialog` shadcn primitive; build segmented/toggle controls from existing tokens.

## Phasing (for the plan)

1. **Foundation:** settings store + a11y CSS + theme/`useGlide` honoring `data-reduce-motion` + the gear entry point + dialog shell with Appearance & Accessibility sections + theme-dedup cleanup.
2. **i18n:** the engine (`en`/`de-CH`/`useTranslations`/format) + the Language section + the full string sweep across the console.

Each phase is independently shippable and testable.

## Testing

Vitest (pure logic — consistent with the project's suite):
- Settings persistence: initializer reads `localStorage`, `setSetting` writes it.
- `t()` interpolation: tokens replaced; missing param left as `{name}`; unknown key returns the key (dev-visible).
- **Dictionary parity:** a test asserting `Object.keys(en)` and `Object.keys(deCH)` are identical (belt-and-suspenders on top of the compile-time `Record` guarantee, and catches empty-string values).
The dialog UI + a11y CSS effects are verified manually (`ssr:false` console).

## Files

- **New:** `lib/settings/{types,settings-provider}.ts(x)`; `lib/i18n/{en,de-CH,index,format}.ts` (+ tests); `components/console/settings/{settings-dialog,appearance-section,accessibility-section,language-section,setting-row,segmented,toggle,settings-button}.tsx`; `components/ui/dialog.tsx` (shadcn re-add).
- **Edit:** `app/globals.css` (a11y blocks + `--text-scale`); `app/dashboard/page.tsx` (mount `SettingsProvider`); `components/console/console-shell.tsx` (settings open state) + `app-sidebar.tsx` (gear, remove bespoke toggle); `components/map/vehicle-marker.tsx` (`useGlide` honors `data-reduce-motion`); every console component named in *The string sweep*; `components/theme-toggle.tsx` (trim if export unused); `CLAUDE.md` (layout + a settings/i18n convention note).

## Out of scope

- Server/SSR locale routing, URL locales, `next-intl` (client console doesn't need them).
- Translating backend/PII data or the driver app.
- Syncing settings across devices; admin-managed defaults.
