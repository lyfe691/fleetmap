# Plan 018: Status-badge exhaustiveness + light-mode contrast + touchscreen target size

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43e4d46..HEAD -- components/console/status-badge.tsx app/globals.css components/console/map-view.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but shares `components/console/map-view.tsx` with plan 016 — see README ordering)
- **Category**: ui
- **Planned at**: commit `43e4d46`, 2026-06-23 (reconciled from `3f5e84b` after plan 016 landed)

> **Reconcile note (2026-06-23):** plan 016 added a "stale" pill in the `SummaryCard`
> header (`map-view.tsx:59-63`), which pushed the close button down to lines
> **64–72** (`size-9` is now line **69**). Leave 016's stale pill untouched —
> only change the close button's `size-9 → size-11`. The contrast (`globals.css`)
> and `StatusBadge` work is unaffected by 016.

## Why this matters

Three small UI-quality issues in the console, all on the touchscreen TV surface:

1. **`StatusBadge` has no exhaustiveness guard.** Its color is chosen by a ternary
   that treats anything not `"onRoute"` as `"waiting"`. If a third `StatusTone`
   is ever added (e.g. `"offline"`, `"maintenance"`), it silently renders as
   amber "waiting" — a wrong status color on a monitoring console, with no compile
   error to catch it.
2. **The "Waiting" badge fails WCAG AA contrast in light mode.** `bg-warning/15`
   (a 15%-opacity amber over a white card) with `text-warning-strong`
   (`oklch(0.52 0.14 70)`) is ~3.5:1 — below the 4.5:1 required for the 13–15px
   semibold badge text. The status is one of the most-glanced elements on the TV.
3. **The map summary's close button is a 36px touch target.** On the stated TV
   *touchscreen* use case, 36px (`size-9`) is below the 44px minimum for reliable
   finger taps (WCAG 2.5.5).

## Current state

```tsx
// components/console/status-badge.tsx:12-16 — non-exhaustive ternary
const tint =
  tone === "onRoute"
    ? "bg-success/15 text-success"
    : "bg-warning/15 text-warning-strong"
const dot = tone === "onRoute" ? "bg-success" : "bg-warning"
```

`StatusTone` is `"onRoute" | "waiting"` (`lib/console/use-console-data.ts:8`).

```css
/* app/globals.css:75-77 — light-mode warning tokens (:root block) */
--warning: oklch(0.74 0.15 75);
--warning-foreground: oklch(0.205 0 0);
--warning-strong: oklch(0.52 0.14 70);   /* <-- too light on a 15% amber tint */
```

```css
/* app/globals.css:116-118 — dark-mode warning tokens (.dark block); leave these */
--warning: oklch(0.828 0.189 84.429);
--warning-foreground: oklch(0.205 0 0);
--warning-strong: oklch(0.85 0.16 85);   /* light text on dark tint — already fine */
```

```tsx
// components/console/map-view.tsx:64-72 — 36px close button (post-016; the
// `{vehicle.stale ? <span…>stale</span> : null}` pill sits just above at 59-63)
<button
  type="button"
  onClick={onClose}
  aria-label="View all vehicles"
  title="View all vehicles"
  className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
>
  <X className="size-5" />
</button>
```

`text-warning-strong` is used in two status surfaces — `StatusBadge` (the
"Waiting" badge) and `history-view.tsx` ("Delayed" pill) — so darkening the light
token improves both consistently. Both are "status text on a 15% tint", the same
visual case.

**Repo conventions**: colors come from the oklch tokens in `globals.css`;
components reference Tailwind token classes (`text-warning-strong`, `bg-warning`).
The idiomatic exhaustiveness pattern in TS is a `Record<Union, …>` (a missing key
becomes a compile error). Use that.

## Commands you will need

| Purpose   | Command                              | Expected on success      |
|-----------|--------------------------------------|--------------------------|
| Install   | `corepack pnpm install`              | exit 0                   |
| Typecheck | `corepack pnpm exec tsc --noEmit`    | exit 0, no errors        |
| Tests     | `corepack pnpm test`                 | all pass (unchanged)     |
| Lint      | `corepack pnpm lint`                 | no *new* errors          |
| Build     | `corepack pnpm build`                | exit 0 (CSS compiles)    |

> Note: use `corepack pnpm …` — `pnpm` is not on the non-interactive PATH.

## Scope

**In scope**:
- `components/console/status-badge.tsx`
- `app/globals.css` (light-mode `--warning-strong` only)
- `components/console/map-view.tsx` (close button size only)

**Out of scope** (do NOT touch):
- The `.dark` block in `globals.css` — dark-mode contrast is already fine.
- `components/console/history-view.tsx` — its color duplication is handled in
  plan 019; this plan only fixes the shared token, which improves it for free.
- Any other token in `globals.css`.
- The `SummaryCard` stale indicator (that's plan 016) — only change the close
  button's `size-9` here.

## Git workflow

- Branch: `advisor/018-ui-a11y-badge-contrast-touch-target`
- Commit per issue; message style conventional commits, e.g.
  `fix(console): exhaustive StatusBadge tone styles`,
  `fix(a11y): darken warning-strong to meet AA on the Waiting badge`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make `StatusBadge` tone styling exhaustive

In `components/console/status-badge.tsx`, replace the two ternaries with a
keyed record so adding a `StatusTone` becomes a compile error:

```tsx
import type { StatusTone } from "@/lib/console/use-console-data"

const TONE_STYLES: Record<StatusTone, { tint: string; dot: string }> = {
  onRoute: { tint: "bg-success/15 text-success", dot: "bg-success" },
  waiting: { tint: "bg-warning/15 text-warning-strong", dot: "bg-warning" },
}
```

Then inside the component: `const { tint, dot } = TONE_STYLES[tone]`. The rendered
markup is otherwise unchanged.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0. (Sanity: temporarily add
`"offline"` to `StatusTone`, confirm `tsc` errors on `TONE_STYLES`, then revert.)

### Step 2: Fix the light-mode "Waiting" badge contrast

In `app/globals.css`, in the **`:root`** block only, darken `--warning-strong`
until the badge text meets WCAG AA (≥4.5:1) against the tinted background. Start
with:

```css
--warning-strong: oklch(0.46 0.13 70);
```

**Verify the contrast ratio** — the badge background is the warning color at 15%
opacity over the white card (`--card: oklch(1 0 0)`). Confirm the chosen text
color yields ≥4.5:1 against `color-mix(in oklch, var(--warning) 15%, white)` using
any contrast checker (browser devtools "Contrast" in the color picker, or an
online WCAG checker). If 0.46 doesn't clear 4.5:1, lower L in 0.02 steps until it
does. Do not exceed darkening that makes "Delayed"/"Waiting" look black — stop at
the first value ≥4.5:1.

**Verify**: `corepack pnpm build` → exit 0 (CSS compiles), and the contrast check
passes (record the measured ratio in the PR description).

### Step 3: Enlarge the map summary close button to a 44px touch target

In `components/console/map-view.tsx`, change the close button from `size-9` to
`size-11` (44px). Keep the icon at `size-5`:

```tsx
className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
```

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0;
`grep -n 'size-11' components/console/map-view.tsx` shows the close button.

## Test plan

These are presentational/token changes with no pure-logic surface; the repo has no
visual-regression or component harness, and adding one is out of scope. Verify via:

- `corepack pnpm build` (CSS compiles, no Tailwind errors).
- The Step-2 contrast measurement (record the ratio).
- Manual check in the PR description: on `/dashboard` in **light** mode, the
  "Waiting"/"Delayed" badge text is clearly legible; the exhaustive record renders
  the same colors as before; the map summary close button is comfortably tappable.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0 (unchanged)
- [ ] `corepack pnpm build` exits 0
- [ ] `grep -n 'Record<StatusTone' components/console/status-badge.tsx` shows the
      exhaustive record; no `tone === "onRoute" ?` ternary remains in the file
- [ ] Light-mode `--warning-strong` darkened in the `:root` block; measured badge
      contrast ≥4.5:1 (ratio noted in PR)
- [ ] `.dark` block `--warning-strong` unchanged (`git diff app/globals.css` review)
- [ ] `grep -n 'size-11' components/console/map-view.tsx` shows the close button
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `StatusTone` is no longer a 2-value union / excerpts drifted.
- You cannot reach ≥4.5:1 without making the text look black (L < ~0.40) — report
  it; the team may prefer raising the tint opacity instead.
- The close button `size-9` is no longer present (plan 016 may have already
  restructured `SummaryCard` — coordinate ordering per the README).

## Maintenance notes

- If a new `StatusTone` is added later, `TONE_STYLES` will force you to define its
  colors — that's the intended safety net.
- The `--warning-strong` darkening also fixes the "Delayed" pill in
  `history-view.tsx` for free; plan 019 then dedupes that pill against
  `StatusBadge`.
- A reviewer should re-check the contrast ratio if `--card` or `--warning` ever
  change (the badge background is derived from both).
