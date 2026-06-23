# Plan 019: Console consistency cleanup — centralize tabs, intervals, and the placeholder note

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Each step is an independent, behavior-preserving refactor — if a
> step's STOP condition fires, skip just that step and report it; the others can
> still land. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3f5e84b..HEAD -- components/console/tracking-view.tsx components/console/history-view.tsx components/console/console-shell.tsx components/console/app-sidebar.tsx lib/console/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch for the affected step, treat it as that step's STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (touches `console-shell.tsx`/`types.ts` — see README ordering vs 014/016)
- **Category**: tech-debt
- **Planned at**: commit `3f5e84b`, 2026-06-23

## Why this matters

The M11 console rebuild left a few small consistency seams. None is a bug, but
each is a place where two copies can silently drift:

- The detail-tab list is hardcoded in `tracking-view.tsx` separately from the
  `DetailTab` *type* in `lib/console/types.ts` — add a tab and you must edit both.
- The placeholder-note text/markup is duplicated across `tracking-view.tsx` and
  `history-view.tsx`.
- The live-refresh interval and the clock-refresh interval are bare magic numbers
  (`useNow(5000)`, `useNow(30_000)`) at their call sites.

This plan does the three **zero-risk, behavior-preserving** consolidations and
explicitly defers the more debatable ones (see "Deliberately deferred").

## Current state

```tsx
// components/console/tracking-view.tsx:22
const TABS: DetailTab[] = ["Overview", "Vehicle", "Cargo"]
// ...used at :66, :73 to render the tablist and compute arrow-key navigation.

// lib/console/types.ts — the type already exists separately
export type DetailTab = "Overview" | "Vehicle" | "Cargo"
```

```tsx
// components/console/tracking-view.tsx:309-315 — local PlaceholderNote
function PlaceholderNote({ className }: { className?: string }) {
  return (
    <p className={`text-[13px] text-muted-foreground/70 ${className ?? ""}`}>
      Placeholder data — pending a vehicle telematics feed.
    </p>
  )
}
// used at :151 (className="mt-2"), :224, :242

// components/console/history-view.tsx:17-19 — inlined, different message, same style
<p className="mt-1 text-[13px] text-muted-foreground/70">
  Placeholder data — pending the orders/deliveries model.
</p>
```

```tsx
// components/console/console-shell.tsx:29
const now = useNow(5000)

// components/console/app-sidebar.tsx:223 (inside OnlinePill)
const now = useNow(30_000)
```

**Repo conventions**: shared types/constants live in `lib/console/*`; shared
presentational atoms live in `components/console/*` (e.g. `status-badge.tsx`).
`as const` / `readonly` is used for fixed tuples. Match the existing import-alias
style (`@/...`).

## Commands you will need

| Purpose   | Command                              | Expected on success      |
|-----------|--------------------------------------|--------------------------|
| Install   | `corepack pnpm install`              | exit 0                   |
| Typecheck | `corepack pnpm exec tsc --noEmit`    | exit 0, no errors        |
| Tests     | `corepack pnpm test`                 | all pass (unchanged)     |
| Lint      | `corepack pnpm lint`                 | no *new* errors          |

> Note: use `corepack pnpm …` — `pnpm` is not on the non-interactive PATH.

## Scope

**In scope**:
- `lib/console/types.ts`
- `lib/console/intervals.ts` (create)
- `components/console/placeholder-note.tsx` (create)
- `components/console/tracking-view.tsx`
- `components/console/history-view.tsx`
- `components/console/console-shell.tsx`
- `components/console/app-sidebar.tsx`

**Out of scope** (do NOT touch):
- `STALE_AFTER_MS` in `components/map/vehicle-marker.tsx` — it is correctly
  colocated with `isStale`; do not move it.
- Any behavior. Every change here must produce byte-identical rendered output.
- `status-badge.tsx`, `map-view.tsx` — see "Deliberately deferred" for why the
  status-color dedup is not done here.

## Git workflow

- Branch: `advisor/019-console-consistency-cleanup`
- One commit per step; message style conventional commits, e.g.
  `refactor(console): single-source DETAIL_TABS`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Single-source the detail tab list

In `lib/console/types.ts`, add next to the `DetailTab` type:

```ts
export const DETAIL_TABS = ["Overview", "Vehicle", "Cargo"] as const
export type DetailTab = (typeof DETAIL_TABS)[number]
```

(Replace the existing standalone `DetailTab` union with this derived form so the
array is the single source of truth.)

In `components/console/tracking-view.tsx`, delete the local
`const TABS: DetailTab[] = [...]` (`:22`) and import `DETAIL_TABS`; replace every
use of `TABS` with `DETAIL_TABS`.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0;
`grep -n 'DETAIL_TABS' components/console/tracking-view.tsx lib/console/types.ts`
shows the shared constant in both; no `const TABS` remains in tracking-view.

### Step 2: Extract a shared `PlaceholderNote`

Create `components/console/placeholder-note.tsx`:

```tsx
import type { ReactNode } from "react"

export function PlaceholderNote({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p className={`text-[13px] text-muted-foreground/70 ${className ?? ""}`}>
      {children}
    </p>
  )
}
```

- In `tracking-view.tsx`: delete the local `PlaceholderNote` (`:309-315`), import
  the shared one, and pass the message as children at each site, preserving the
  `className` where present:
  - `:151` → `<PlaceholderNote className="mt-2">Placeholder data — pending a vehicle telematics feed.</PlaceholderNote>`
  - `:224`, `:242` → same message, no className.
- In `history-view.tsx`: replace the inline `<p …>` (`:17-19`) with
  `<PlaceholderNote className="mt-1">Placeholder data — pending the orders/deliveries model.</PlaceholderNote>`.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0; the rendered text/classes
are unchanged (compare the strings); no local `PlaceholderNote` remains in
tracking-view.

### Step 3: Name the polling intervals

Create `lib/console/intervals.ts`:

```ts
// Console polling cadences. The live tick drives staleness re-evaluation and
// route-feature recompute; the clock tick only refreshes the wall clock.
export const LIVE_TICK_MS = 5000
export const CLOCK_TICK_MS = 30_000
```

- `console-shell.tsx:29` → `const now = useNow(LIVE_TICK_MS)` (add the import).
- `app-sidebar.tsx:223` → `const now = useNow(CLOCK_TICK_MS)` (add the import).

Values are identical to today — this is naming only.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0;
`grep -rn 'useNow(5000)\|useNow(30_000)' components/console` returns nothing
(both replaced).

## Test plan

All three steps are behavior-preserving refactors with no new logic, so they have
no new unit surface. The safety net is:

- `corepack pnpm exec tsc --noEmit` (the derived `DetailTab` type + imports must
  resolve).
- `corepack pnpm test` stays green (40 unchanged).
- A `git diff` review confirming rendered strings/classes/interval values are
  identical to before.

Do not add tests or a component harness for this plan.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0 (40, unchanged)
- [ ] `grep -rn 'const TABS' components/console/tracking-view.tsx` → no matches
- [ ] `grep -rn 'function PlaceholderNote' components/console/tracking-view.tsx` → no matches
- [ ] `grep -rn 'useNow(5000)\|useNow(30_000)' components/console` → no matches
- [ ] `DETAIL_TABS`, `PlaceholderNote`, `LIVE_TICK_MS`/`CLOCK_TICK_MS` each have a
      single definition and ≥1 importer
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop (skip just that step) and report if:

- Deriving `DetailTab` from `DETAIL_TABS` breaks a consumer that relied on the
  union being declared a certain way (it shouldn't — the resolved type is
  identical).
- A placeholder note's text or surrounding classes would change (they must not —
  this is a pure extraction).
- Any interval value would change (it must not).

## Deliberately deferred (considered, NOT done — record so they aren't re-audited)

- **DEBT-02: status-color duplication between `StatusBadge` and `history-view`'s
  "Delivered/Delayed" pill.** Deferred: every dedup forces the trip pill to adopt
  `StatusBadge`'s `onRoute`/`waiting` tone vocabulary, which is semantically wrong
  for trip history (a delivered trip is not "on route"). Net readability is worse,
  not better. Plan 018 already fixes the underlying contrast token for both, which
  was the only real cost of the duplication.
- **DEBT-05: `DetailRow` icon selection spread across `VehicleTab` (inline) and
  `CargoTab` (lookup table).** Deferred: the two paths are genuinely different
  (static per-row icons vs a dynamic manifest keyed lookup); a shared
  `getDetailIcon` helper would couple them without removing real duplication.
- **DEBT-06: card border-radius inconsistency (`rounded-[20px]` vs `rounded-2xl`).**
  Deferred: this is a design decision, not a mechanical cleanup — standardizing on
  one radius could regress the intended visual hierarchy. Needs a design call
  (which cards are "primary" at 20px vs "secondary" at 16px) before any change.

## Maintenance notes

- After Step 1, adding a detail tab is a single edit to `DETAIL_TABS`; the type
  follows automatically.
- If the live/clock cadences are ever made user-configurable, `lib/console/intervals.ts`
  is the seam to wire that through.
- A reviewer should confirm the diff is purely mechanical (no rendered-output
  change) — that is the entire safety argument for this plan.
