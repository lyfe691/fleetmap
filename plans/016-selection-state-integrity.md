# Plan 016: Selection-state integrity — consistent rail highlight + stale indicator on the map summary card

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 94df1f0..HEAD -- components/console/console-shell.tsx components/console/fleet-rail.tsx components/console/map-view.tsx lib/console/types.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `94df1f0`, 2026-06-23 (reconciled from `3f5e84b` after plan 014 landed)

> **Reconcile note (2026-06-23):** plan 014 added a `useEffect(() => setTab("Overview"), [selectedId])` at `console-shell.tsx:56-58` and now imports `useEffect`. That is unrelated to this plan and must be left untouched. It shifted the line numbers below by ~4; excerpts here reflect the current (`94df1f0`) line numbers. This plan still adds NO `useEffect` of its own (Step 3 is a plain click handler).

## Why this matters

Two selection/data-consistency gaps in the console:

1. **Rail highlight desyncs from the filter.** The fleet rail filters its own list
   by `statusFilter`, but the selection lives in `ConsoleShell` independently. If
   an operator selects van A, then clicks a status filter that excludes A, the
   rail shows *no* highlighted card while the Tracking view still shows van A —
   an inconsistent, confusing state.
2. **The map summary card ignores staleness.** The fleet rail marks a van "· stale"
   when its GPS is old (`fleet-rail.tsx:161`), but the map's `SummaryCard` renders
   `Speed`/`ETA` unconditionally with no stale indicator. On a wall-mounted TV,
   that means the map can present an old position's numbers as if they were live.

This plan fixes both with minimal, low-risk changes and is explicit about a third,
related item it deliberately does **not** attempt (see "Deliberately out of scope").

## Current state

```tsx
// console-shell.tsx:52-54 — selection + filter are independent state
const [selectedId, setSelectedId] = useState<string | null>(null)
const [tab, setTab] = useState<DetailTab>("Overview")
const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")

// console-shell.tsx:56-58 — plan 014's tab-reset effect (leave it untouched)
useEffect(() => {
  setTab("Overview")
}, [selectedId])

// console-shell.tsx:72-73
const explicit = consoleVehicles.find((v) => v.id === selectedId) ?? null
const selected = explicit ?? consoleVehicles[0] ?? null

// console-shell.tsx:102-111 — FleetRail gets the filter + an onStatusFilter setter
<FleetRail
  vehicles={consoleVehicles}
  selectedId={selected?.id ?? null}
  onSelect={setSelectedId}
  statusFilter={statusFilter}
  onStatusFilter={setStatusFilter}          // <-- line 107; Step 3 swaps this
  ...
/>
```

```tsx
// fleet-rail.tsx:54-60 — the filter predicate (duplicated logic to extract)
const filtered = vehicles.filter((v) =>
  statusFilter === "All"
    ? true
    : statusFilter === "On Route"
      ? v.tone === "onRoute"
      : v.tone === "waiting"
)
```

```tsx
// map-view.tsx:45-74 — SummaryCard renders stats with NO stale awareness
function SummaryCard({ vehicle, onShowDetails, onClose }) {
  return (
    <div className="absolute top-6 left-6 z-10 w-[360px] rounded-[20px] border border-border bg-surface p-6 shadow-md">
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[20px] font-semibold">{vehicle.reg}</span>
        <StatusBadge tone={vehicle.tone} label={vehicle.statusLabel} size="md" />
        ...
      </div>
      <div className="mt-5 flex gap-5">
        <Stat label="Speed" value={vehicle.speedText} />
        <Stat label="ETA" value={vehicle.etaText} />
        <Stat label="Load" value={`${vehicle.capacityPct}%`} note />
      </div>
      ...
```

`ConsoleVehicle` already exposes `stale: boolean` (`lib/console/use-console-data.ts:18`),
and the rail uses it like this for the pattern to mirror:

```tsx
// fleet-rail.tsx:157-162
{onRoute ? `${vehicle.stopsLeft} stop…` : "Awaiting dispatch"}
{vehicle.stale ? " · stale" : ""}
```

`StatusFilter` is the union `"All" | "On Route" | "Waiting"` in `lib/console/types.ts`.

**Repo conventions**: shared pure helpers live in `lib/console/*`; `ConsoleShell`
owns state and passes setters down. Match the existing className/token style
(muted-foreground, `text-warning-strong`, etc.).

## Commands you will need

| Purpose   | Command                              | Expected on success      |
|-----------|--------------------------------------|--------------------------|
| Install   | `corepack pnpm install`              | exit 0                   |
| Typecheck | `corepack pnpm exec tsc --noEmit`    | exit 0, no errors        |
| Tests     | `corepack pnpm test`                 | all pass (40 + new)      |
| Lint      | `corepack pnpm lint`                 | no *new* errors          |

> Note: use `corepack pnpm …` — `pnpm` is not on the non-interactive PATH.

## Scope

**In scope**:
- `lib/console/types.ts` (add a small pure predicate)
- `lib/console/status-filter.test.ts` (create — tests the predicate)
- `components/console/fleet-rail.tsx` (use the predicate)
- `components/console/console-shell.tsx` (clear a hidden selection on filter click)
- `components/console/map-view.tsx` (stale indicator on the summary card)

**Out of scope** (do NOT touch):
- The map's own selection path (`onSelectVehicle={setSelectedId}` in
  `console-shell.tsx`/`map-view.tsx`) — do NOT add any effect that re-points
  selection based on the filter; it would fight a map marker click (the map shows
  all vans regardless of the rail filter). The clear-on-filter-click in Step 3 is
  safe precisely because it fires only on an explicit filter-button press.

## Git workflow

- Branch: `advisor/016-selection-state-integrity`
- Commit per part; message style conventional commits, e.g.
  `fix(console): show stale state on the map summary card`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Extract the status-filter predicate (dedupe + reuse)

In `lib/console/types.ts`, add (keep it pure; it must not import React):

```ts
import type { ConsoleVehicle } from "@/lib/console/use-console-data"

export function matchesStatusFilter(
  v: Pick<ConsoleVehicle, "tone">,
  filter: StatusFilter
): boolean {
  if (filter === "All") return true
  if (filter === "On Route") return v.tone === "onRoute"
  return v.tone === "waiting" // "Waiting"
}
```

> If `lib/console/types.ts` would create an import cycle with `use-console-data.ts`
> (it imports `ConsoleVehicle`), instead put `matchesStatusFilter` in a new file
> `lib/console/status-filter.ts` and import `StatusFilter` from `types.ts` there.
> Check with `corepack pnpm exec tsc --noEmit`; if it complains about a cycle, use
> the separate file.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 2: Use the predicate in `FleetRail`

Replace the inline `filtered` predicate (`fleet-rail.tsx:54-60`) with the helper:

```tsx
const filtered = vehicles.filter((v) => matchesStatusFilter(v, statusFilter))
```

Add the import. Behavior is unchanged here — this is the dedupe.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 3: Clear a now-hidden explicit selection when the filter changes

In `console-shell.tsx`, wrap the `onStatusFilter` handler so that pressing a
filter that hides the explicitly-selected van drops the explicit selection (the
view then falls back to the first van — consistent with the rail). This fires
ONLY on the filter-button click, so it cannot fight a map selection.

Replace `onStatusFilter={setStatusFilter}` (`:107`) with
`onStatusFilter={handleStatusFilter}` and add:

```tsx
const handleStatusFilter = (filter: StatusFilter) => {
  setStatusFilter(filter)
  if (selectedId != null) {
    const sel = consoleVehicles.find((v) => v.id === selectedId)
    if (sel && !matchesStatusFilter(sel, filter)) setSelectedId(null)
  }
}
```

Import `matchesStatusFilter`. (`StatusFilter` is already imported.)

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 4: Show stale state on the map summary card

In `map-view.tsx` `SummaryCard`, mirror the rail's staleness signal. Add a small
"stale" pill next to the status badge when `vehicle.stale`, and append a stale
qualifier so the numbers don't read as live. Minimal version — add after the
`StatusBadge` in the header row (`:58`):

```tsx
{vehicle.stale ? (
  <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-semibold text-muted-foreground">
    stale
  </span>
) : null}
```

And give the live-numbers row a muted treatment when stale — change the stats row
container (`:70`) to:

```tsx
<div className={`mt-5 flex gap-5 ${vehicle.stale ? "opacity-60" : ""}`}>
```

(Use the existing `Stat` component unchanged; this only adds a stale pill and a
muted treatment, matching how the rail de-emphasizes stale vans.)

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 5: Unit-test the predicate

Create `lib/console/status-filter.test.ts` covering `matchesStatusFilter`:
- `"All"` → true for both tones.
- `"On Route"` → true only for `tone: "onRoute"`.
- `"Waiting"` → true only for `tone: "waiting"`.

Model after `lib/route-slice.test.ts`.

**Verify**: `corepack pnpm test` → all pass, 3 new cases green.

## Test plan

- `lib/console/status-filter.test.ts` (new): locks the extracted predicate so the
  dedupe + the Step-3 clear logic can't silently diverge from the rail's filter.
- The map-card stale indicator and the clear-on-filter behavior have no pure unit
  surface and the repo has no component harness — do NOT add one. Document a manual
  check in the PR description:
  1. Select a van, click a filter that excludes it → the rail shows no stale phantom
     highlight and the tracking view falls back to the first van (no inconsistent
     "highlight missing but van shown" state).
  2. With the fake feed paused (so a van goes stale after 30s), open that van on the
     Live Map → the summary card shows a "stale" pill and muted numbers.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0; `status-filter` test exists with 3 passing cases
- [ ] `grep -rn 'matchesStatusFilter' components/console lib/console` shows it used
      in BOTH `fleet-rail.tsx` and `console-shell.tsx` (single source of truth)
- [ ] `grep -n 'stale' components/console/map-view.tsx` shows the new indicator
- [ ] The map selection handler (`onSelectVehicle`) is unchanged — no new effect
      re-points selection from the filter (`git diff` review)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Excerpts don't match (files drifted).
- `matchesStatusFilter` in `types.ts` causes an import cycle AND moving it to
  `lib/console/status-filter.ts` does not resolve it.
- You find yourself adding a `useEffect` that calls `setSelectedId` based on
  `statusFilter`/`consoleVehicles` — that is the fights-map-selection trap this
  plan forbids. Use only the filter-button-click handler from Step 3.

## Deliberately out of scope (considered, not done — record so it isn't re-audited)

- **Auto-re-pointing selection on any filter/data change** (BUG-01's broader
  framing): rejected — an effect that re-points selection would override a map
  marker click (the map ignores the rail filter), producing worse UX than the
  mild inconsistency it fixes. The bounded filter-button-click clear in Step 3 is
  the safe subset.
- **A toast/notification when the selected van is removed live and selection
  falls back to van[0]** (BUG-03): deferred — there is no notification system in
  the console, and a silent fallback to "show some van" is acceptable for a
  monitoring TV. The Step-4 stale indicator already covers the common
  "selected van went stale" case visibly. Revisit only if live vehicle deletion
  becomes a real operational event.

## Maintenance notes

- If selection ever becomes URL-synced or multi-select, the Step-3 clear logic
  and the rail filter must be reconciled in the routing layer.
- A reviewer should confirm no `setSelectedId` call was added inside a
  `useEffect` (only inside the `handleStatusFilter` click handler).
