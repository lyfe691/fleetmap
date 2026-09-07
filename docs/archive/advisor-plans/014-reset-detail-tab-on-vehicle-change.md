# Plan 014: Reset the detail tab to "Overview" when the selected vehicle changes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3f5e84b..HEAD -- components/console/console-shell.tsx components/console/tracking-view.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3f5e84b`, 2026-06-23

## Why this matters

In the monitoring console's Live Tracking view, the detail tab
(`Overview` / `Vehicle` / `Cargo`) is held in `ConsoleShell` state and never
resets when the operator selects a different vehicle. So if you're reading van
A's **Cargo** tab and click van B in the fleet rail, you land on van B's Cargo
tab — not the default Overview. The Overview tab is the one with the live map and
route progress; it's the expected landing surface for "I just picked a different
truck." This is a small but constant UX papercut on the console's primary view.

## Current state

- `components/console/console-shell.tsx` holds both the selection and the tab:

  ```tsx
  // console-shell.tsx:51-53
  const [view, setView] = useState<ConsoleView>("tracking")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>("Overview")
  ```

  ```tsx
  // console-shell.tsx:68-69 — `selected` is derived from selectedId (or first van)
  const explicit = consoleVehicles.find((v) => v.id === selectedId) ?? null
  const selected = explicit ?? consoleVehicles[0] ?? null
  ```

  ```tsx
  // console-shell.tsx:126-138 — tab is passed straight through to TrackingView
  {view === "tracking" ? (
    selected ? (
      <TrackingView
        vehicle={selected}
        live={live}
        tab={tab}
        onTab={setTab}
        onLocate={() => setView("map")}
      />
    ) : (
      <EmptyMain label="No vehicles to track yet" />
    )
  ) : null}
  ```

- Selection is changed by the rail (`onSelect={setSelectedId}` at
  `console-shell.tsx:100`) and by the map (`onSelectVehicle={setSelectedId}` at
  `:142-148`). The bug applies to both entry points.

- `DetailTab` is defined in `lib/console/types.ts`:
  ```ts
  // lib/console/types.ts (the DetailTab union)
  export type DetailTab = "Overview" | "Vehicle" | "Cargo"
  ```

- `TrackingView` is a stateless presentational component — it renders whatever
  `tab` prop it's given (`components/console/tracking-view.tsx:24-111`). It is
  **correct** as-is; the fix belongs in `ConsoleShell`, which owns the state.

**Repo conventions to match**: state lives in `ConsoleShell`; child views are
presentational and lifted-state-driven. Effects in this codebase are written with
explicit, minimal dependency arrays (see the camera effect in
`components/map/fleet-map-view.tsx:73-107` and the live hooks). Match that style.

## Commands you will need

| Purpose   | Command                              | Expected on success      |
|-----------|--------------------------------------|--------------------------|
| Install   | `corepack pnpm install`              | exit 0                   |
| Typecheck | `corepack pnpm exec tsc --noEmit`    | exit 0, no errors        |
| Tests     | `corepack pnpm test`                 | all pass                 |
| Lint      | `corepack pnpm lint`                 | no *new* errors          |

> Note: use `corepack pnpm …` — `pnpm` is not on the non-interactive PATH.
> `corepack pnpm lint` is pre-existing-red; only avoid adding *new* errors.

## Scope

**In scope** (the only files you should modify):
- `components/console/console-shell.tsx`

**Out of scope** (do NOT touch):
- `components/console/tracking-view.tsx` — it is correctly presentational; do not
  move tab state into it. Moving state down would also reset the tab on every
  live re-render, which is wrong.
- The map/rail selection handlers' signatures — keep `setSelectedId` as the
  `onSelect`/`onSelectVehicle` callback.

## Git workflow

- Branch: `advisor/014-reset-detail-tab-on-vehicle-change`
- Commit message style: conventional commits, e.g.
  `fix(console): reset detail tab to Overview on vehicle change`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Reset `tab` to "Overview" when `selectedId` changes

In `components/console/console-shell.tsx`, add an effect that resets the tab
whenever the *user's* selection changes. Key on `selectedId` (the explicit pick),
**not** `selected?.id` — keying on the derived `selected` would also reset the
tab when the first-van fallback changes due to live data, which is not a user
action.

Add, after the existing `useState` declarations (near `:51-62`):

```tsx
useEffect(() => {
  setTab("Overview")
}, [selectedId])
```

Add `useEffect` to the existing React import at the top of the file
(`import { useEffect, useMemo, useState } from "react"`).

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 2: Confirm behavior by reasoning through the two selection paths

- Rail click → `setSelectedId(B)` → effect fires (selectedId changed) → tab =
  "Overview". ✓
- Map marker click → `setSelectedId(B)` → same. ✓
- "View all" / clear selection (`onClearSelection={() => setSelectedId(null)}` at
  `:146`) → `selectedId` becomes `null` → effect fires → tab = "Overview". This
  is fine: when you next open tracking, you start on Overview.
- A live GPS update that does NOT change `selectedId` → effect does **not** fire
  → tab is preserved. ✓ (This is why we key on `selectedId`, not `selected?.id`.)

No code change in this step — just confirm the above matches the code you wrote.

**Verify**: `corepack pnpm test` → all pass (no behavior the existing suite covers
changes).

## Test plan

This is pure UI state wiring with no extractable pure function, and the repo has
no component-test harness (`vitest` runs in `environment: "node"`, no
`@testing-library/react`). Do **not** add a test harness for this. Instead:

- Rely on `tsc` + the existing suite staying green, and on the manual
  verification below.
- Manual check (for the reviewer/operator, document it in the PR description):
  open `/dashboard`, select a van, open the **Cargo** tab, then click a different
  van in the rail → the view must land on **Overview**. Then trigger a GPS tick
  (the fake feed posts every 5s) while on **Vehicle** tab → the tab must NOT jump
  back to Overview.

If you believe a regression test is essential, STOP and report rather than adding
a new testing dependency.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0 (unchanged count, all green)
- [ ] `grep -n 'setTab("Overview")' components/console/console-shell.tsx` shows
      the new effect
- [ ] The effect's dependency array is exactly `[selectedId]` (not `[selected]`
      or `[selected?.id]`)
- [ ] No files outside `components/console/console-shell.tsx` are modified
      (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `console-shell.tsx` no longer holds `tab` state / the excerpts don't match.
- A regression test seems necessary (would require a new dev dependency).
- You discover the tab is already reset somewhere else (then this is a no-op —
  report it).

## Maintenance notes

- If detail tabs are ever made deep-linkable (URL-synced), this reset must move
  into the routing layer instead of a bare effect.
- A reviewer should confirm the dependency array is `[selectedId]` — the most
  likely wrong-but-plausible variant is `[selected?.id]`, which would reset the
  tab on the first-van fallback during live updates.
