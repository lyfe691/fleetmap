# Plan 008: Remove dead shadcn scaffolding (9 unused deps + 8 unused UI primitives)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a8b6215..HEAD -- package.json components/ui`
> If `package.json` or any file under `components/ui` changed since this plan
> was written, compare the "Current state" facts below against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `a8b6215`, 2026-06-22

## Why this matters

The project was scaffolded with the shadcn CLI, which copied in a full set of UI
primitives and pulled their npm dependencies. The app uses only a handful of
them. Eight generated primitives are referenced by **zero** application files,
and the nine npm packages they pull in are dead weight in the bundle and the
dependency-audit surface. Removing them shrinks the install, removes maintenance
and advisory noise, and — as a bonus — deletes `components/ui/calendar.tsx`,
which is the lone file still producing a pre-existing `tsc` error in this repo
(noted in `plans/README.md` follow-ups). This is the cheapest "clean base" win.

## Current state

Verified at commit `a8b6215`:

- Each of these 8 generated primitives is imported by **0** files under `app/`,
  `lib/`, `components/map/`, `components/driver/` (confirmed by grep):
  - `components/ui/chart.tsx` — imports `recharts`
  - `components/ui/carousel.tsx` — imports `embla-carousel-react`
  - `components/ui/calendar.tsx` — imports `react-day-picker` (and transitively `date-fns`)
  - `components/ui/drawer.tsx` — imports `vaul`
  - `components/ui/input-otp.tsx` — imports `input-otp`
  - `components/ui/command.tsx` — imports `cmdk`
  - `components/ui/sonner.tsx` — imports `sonner`
  - `components/ui/resizable.tsx` — imports `react-resizable-panels`
- `date-fns` is imported by **0** files anywhere in the repo.
- No `<Toaster>` / `sonner` usage exists in `app/layout.tsx` or anywhere else.
- `package.json` lists all nine packages in `dependencies` (lines 21–44):
  `recharts`, `embla-carousel-react`, `react-day-picker`, `vaul`, `input-otp`,
  `cmdk`, `sonner`, `react-resizable-panels`, `date-fns`.

The UI components that ARE used (do not touch): `alert`, `button`, `card`,
`field`, `input`, `spinner` (imported across `components/map/*` and
`components/driver/*`).

Repo convention: package manager is **pnpm**; the only verification gates are
`pnpm exec tsc --noEmit` (must stay clean) and `pnpm lint` (warnings only). There
is no test suite yet.

## Commands you will need

| Purpose   | Command                              | Expected on success         |
|-----------|--------------------------------------|-----------------------------|
| Typecheck | `pnpm exec tsc --noEmit`             | exit 0, **no errors**       |
| Lint      | `pnpm lint`                          | exit 0 (warnings allowed)   |
| Build     | `pnpm build`                         | exit 0, build completes     |
| Grep      | `grep -rn "<pattern>" app lib components` | (used for verification) |

Note: `pnpm exec tsc --noEmit` is currently expected to emit **one** error from
`components/ui/calendar.tsx`. After this plan it must be fully clean.

## Scope

**In scope** (the only files you should modify or delete):
- `package.json` — remove the 9 dependencies
- Delete: `components/ui/chart.tsx`, `components/ui/carousel.tsx`,
  `components/ui/calendar.tsx`, `components/ui/drawer.tsx`,
  `components/ui/input-otp.tsx`, `components/ui/command.tsx`,
  `components/ui/sonner.tsx`, `components/ui/resizable.tsx`
- `pnpm-lock.yaml` — will update automatically via `pnpm install`

**Out of scope** (do NOT touch):
- Any other file under `components/ui/` — even if unused, zero-dependency
  primitives are kept; the dispatcher/driver UI work in the backlog will want
  them, and deleting them now is churn with no benefit.
- Any `app/`, `lib/`, `components/map`, `components/driver` file — none import
  the removed primitives; if you find one that does, that is a STOP condition.

## Git workflow

- Branch: `advisor/008-remove-dead-shadcn-scaffolding`
- Commit style: conventional commits (match `git log`, e.g.
  `chore(deps): drop unused shadcn scaffolding deps + primitives`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Prove the 8 primitives are unreferenced before deleting

Run this and confirm it prints `0` for every file:

```
for f in chart carousel calendar drawer input-otp command sonner resizable; do
  echo -n "ui/$f referenced by: "
  grep -rl -E "/ui/$f\"|/ui/$f'" app lib components/map components/driver 2>/dev/null | wc -l
done
```

**Verify**: every line ends in `0`. If any line is non-zero, **STOP** — that
primitive is in use and this plan's premise has drifted.

### Step 2: Delete the 8 generated primitive files

Delete exactly the eight files listed in Scope.

**Verify**: `ls components/ui/{chart,carousel,calendar,drawer,input-otp,command,sonner,resizable}.tsx 2>/dev/null | wc -l` → `0`

### Step 3: Remove the 9 dependencies from package.json

Remove these lines from `dependencies` in `package.json`: `recharts`,
`embla-carousel-react`, `react-day-picker`, `vaul`, `input-otp`, `cmdk`,
`sonner`, `react-resizable-panels`, `date-fns`. Then refresh the lockfile:

```
pnpm install
```

**Verify**: `pnpm install` exits 0; `grep -E "\"(recharts|embla-carousel-react|react-day-picker|vaul|input-otp|cmdk|sonner|react-resizable-panels|date-fns)\":" package.json | wc -l` → `0`

### Step 4: Typecheck and build clean

**Verify**:
- `pnpm exec tsc --noEmit` → exit 0, **zero errors** (the previous
  `calendar.tsx` error is now gone).
- `pnpm build` → exit 0.
- `pnpm lint` → exit 0 (the 13 pre-existing warnings are unrelated and may
  remain; the count may drop slightly if a removed file had warnings — that is
  fine).

## Test plan

No automated tests exist yet (a test runner is introduced in plan 009). Manual
verification is the typecheck + build above. After the build, optionally run
`pnpm dev`, open `/dashboard` and `/driver`, and confirm both render — no import
errors in the browser console.

## Done criteria

ALL must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0 with **no** errors (calendar error gone)
- [ ] `pnpm build` exits 0
- [ ] The 8 primitive files no longer exist
- [ ] The 9 dependencies are absent from `package.json`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

Stop and report (do not improvise) if:

- Step 1 shows any of the 8 primitives is referenced by an app file.
- `pnpm build` fails with a missing-module error naming any removed package —
  that means a transitive importer exists that grep missed; report it.
- Removing `date-fns` breaks the build (some other dep relied on it as a direct
  import) — report rather than re-adding blindly.

## Maintenance notes

- If future UI work (dispatcher panel, driver stop-list) needs a table, dialog,
  command palette, etc., re-add the specific shadcn component via
  `pnpm dlx shadcn@latest add <name>` rather than keeping dead scaffolding now.
- Reviewer should confirm `git status` shows only `package.json`,
  `pnpm-lock.yaml`, and the 8 deletions — nothing else.
