# Plan 003: Simplify `useFleetRoutes` — drop the serialize-then-reparse round-trip

> **Executor instructions**: Follow step by step; run every verification command.
> On a "STOP conditions" item, stop and report. Update the 003 row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- lib/use-fleet-routes.ts`
> Also confirm Plan 002 has landed (the file should import `Route` from
> `@/lib/route-types`). If 002 has not landed, do it first or treat as a STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 002 (same file; 002 updates the type import)
- **Category**: tech-debt
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

`useFleetRoutes` builds a stable primitive `jobsKey` string from the jobs array
(correct — it's the `useEffect` dependency), but then **parses that string back
into objects** inside the effect (`entry.indexOf("@")`, `slice`). That round-trip
is needless indirection: the structured `jobs` are already in scope. It's a KISS
smell and a latent bug — adding a field to `RouteJob` (or a `@` appearing in a
key) would silently corrupt the parse. Keeping `jobsKey` as the dependency but
reading the real `jobs` (via a ref, to satisfy exhaustive-deps without re-running
on identity churn) removes the parser entirely with no behavior change.

## Current state

`lib/use-fleet-routes.ts:28-83` (the hook). The relevant parts:

```ts
export function useFleetRoutes(jobs: RouteJob[]): Map<string, Route> {
  const [routes, setRoutes] = useState<Map<string, Route>>(new Map())
  const cacheRef = useRef(new Map<string, { stopsKey: string; route: Route }>())

  // Stable primitive dep: re-run only when the set of (vehicle, stopSet) changes.
  const jobsKey = jobs
    .map((j) => `${j.vehicleId}@${j.stopsKey}`)
    .sort()
    .join(",")

  useEffect(() => {
    let cancelled = false

    const parsed: RouteJob[] = jobsKey
      ? jobsKey.split(",").map((entry) => {
          const at = entry.indexOf("@")
          return {
            vehicleId: entry.slice(0, at),
            stopsKey: entry.slice(at + 1),
          }
        })
      : []

    const run = async () => {
      ...
      const present = new Set(parsed.map((j) => j.vehicleId))
      ...
      await Promise.all(
        parsed.map(async (j) => { ... })
      )
      ...
    }
    void run()
    return () => { cancelled = true }
  }, [jobsKey])

  return routes
}
```

`RouteJob` is `{ vehicleId: string; stopsKey: string }`. The effect uses `parsed`
in exactly two places: building the `present` set and the `Promise.all` map.

Convention: this is a `"use client"` hook; keep the existing comments' intent.
The codebase already uses the `ref-mirrors-latest-value` pattern (e.g.
`posRef.current = pos` in `components/map/fleet-map.tsx`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 except known `calendar.tsx` error |
| Lint | `pnpm lint` | exit 0, no react-hooks/exhaustive-deps warning for this effect |
| Confirm parser gone | `grep -n "indexOf(\"@\")\|jobsKey.split" lib/use-fleet-routes.ts` | no matches |

## Scope

**In scope**: `lib/use-fleet-routes.ts` only.
**Out of scope**: `RouteJob` shape, the `jobsKey` *format* (callers don't depend
on it), and the caching semantics (re-fetch only on stop-set change must be
preserved).

## Git workflow

- Branch: `advisor/003-simplify-usefleetroutes`.
- One commit: `refactor: drop jobsKey reparse in useFleetRoutes`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Steps

### Step 1: Mirror `jobs` in a ref and delete the parser

Keep `jobsKey` exactly as is (it stays the effect dependency). Add a ref that
always holds the latest `jobs`, and read it inside the effect instead of parsing
the string. Target shape:

```ts
  // Stable primitive dep: re-run only when the set of (vehicle, stopSet) changes.
  const jobsKey = jobs
    .map((j) => `${j.vehicleId}@${j.stopsKey}`)
    .sort()
    .join(",")

  // Read the live jobs inside the effect without making it a dependency:
  // jobsKey already captures every change that should trigger a re-run.
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs

  useEffect(() => {
    let cancelled = false
    const current = jobsRef.current

    const run = async () => {
      const { data } = await getBrowserClient().auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      const cache = cacheRef.current
      const present = new Set(current.map((j) => j.vehicleId))
      for (const id of [...cache.keys()]) {
        if (!present.has(id)) cache.delete(id)
      }

      await Promise.all(
        current.map(async (j) => {
          const cached = cache.get(j.vehicleId)
          if (cached && cached.stopsKey === j.stopsKey) return
          const route = await fetchRoute(j.vehicleId, token)
          if (route) cache.set(j.vehicleId, { stopsKey: j.stopsKey, route })
          else cache.delete(j.vehicleId)
        })
      )

      if (cancelled) return
      setRoutes(new Map([...cache].map(([id, v]) => [id, v.route])))
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [jobsKey])
```

The `parsed` variable and the `.split(",").map(...)` block are removed entirely.

**Verify**: `pnpm exec tsc --noEmit` → only known `calendar.tsx` error.
`grep -n "jobsKey.split" lib/use-fleet-routes.ts` → no matches.

### Step 2: Confirm the lint/deps contract

The effect now reads `jobsRef` (a ref — stable, not a dep) and depends only on
`jobsKey`. Run `pnpm lint`; there must be **no** `react-hooks/exhaustive-deps`
warning for this effect. If one appears, do NOT add `jobs` to the dep array
(that re-introduces re-runs on every render); the ref pattern is intentional —
add the eslint-disable line the repo already uses elsewhere only if the repo has
that convention, otherwise report.

**Verify**: `pnpm lint` → exit 0.

## Test plan

No automated suite. Smoke check: `pnpm dev` + `/dashboard` with a moving vehicle
(`pnpm fake-gps`) — routes still appear and still re-fetch only on stop-set
changes (watch the Network tab: no `/api/route` call per GPS ping).

## Done criteria

ALL must hold:

- [ ] No `.split(",")` reparse / `indexOf("@")` remains in `lib/use-fleet-routes.ts`.
- [ ] The effect dependency array is still `[jobsKey]`.
- [ ] `pnpm exec tsc --noEmit` exits 0 (except known error); `pnpm lint` exits 0.
- [ ] Manual smoke: routes render and re-fetch only on stop-set change.
- [ ] `plans/README.md` 003 row updated.

## STOP conditions

- Plan 002 has not landed (the file still imports `Route` from `@/lib/use-route`)
  — do 002 first or report.
- `pnpm lint` produces an exhaustive-deps warning and the repo has no existing
  eslint-disable convention to match — report rather than guessing.

## Maintenance notes

- If `RouteJob` ever needs another field, the cache key (`stopsKey`) and the
  `jobsKey` builder are the two places to update — there is no longer a parser to
  keep in sync.
- The "fetch only on stop-set change" guarantee lives in `jobsKey` (the dep) and
  the `cached.stopsKey === j.stopsKey` check; keep both when editing.
