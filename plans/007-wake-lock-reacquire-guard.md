# Plan 007: Guard the wake-lock re-acquire so a held sentinel can't leak

> **Executor instructions**: Follow step by step; run every verification command.
> On a "STOP conditions" item, stop and report. Update the 007 row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- lib/use-wake-lock.ts`
> If changed, compare the excerpt below to live code; on mismatch, treat as STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt (resource leak)
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

`useWakeLock.acquire()` requests a fresh `WakeLockSentinel` every time it runs and
overwrites `sentinelRef.current` without releasing the previous one. `acquire` is
called on `enable()` AND on every `visibilitychange → visible` while `wantRef` is
true. If it runs while a lock is **already held** (e.g. a visibility flap that
didn't actually release the OS lock), the previous sentinel is orphaned — never
released, its `release` listener never fires. On a driver PWA left open for a long
shift this slowly leaks sentinels. The fix is a one-line guard: don't re-acquire
when a live sentinel is already held. Low risk, correct behavior preserved (the
mandatory re-acquire after a real OS release still happens, because a real release
nulls `sentinelRef` via its listener).

## Current state

`lib/use-wake-lock.ts:15-28` — `acquire`:

```ts
  const acquire = useCallback(async () => {
    if (!wantRef.current) return
    try {
      const sentinel = await navigator.wakeLock.request("screen")
      sentinelRef.current = sentinel
      setActive(true)
      sentinel.addEventListener("release", () => {
        sentinelRef.current = null
        setActive(false)
      })
    } catch {
      setActive(false)
    }
  }, [])
```

Key facts that make the guard correct:
- When the OS auto-releases the lock (tab hidden), the `release` listener sets
  `sentinelRef.current = null`. So a *real* release always nulls the ref.
- Therefore "ref is non-null" reliably means "we still hold a live lock" — safe to
  skip a redundant `request`.
- `disable()` already nulls the ref and releases, so it's unaffected.

Convention: terse purpose-first comments; `"use client"` hook; match existing
style.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0 except known `calendar.tsx` error |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**: `lib/use-wake-lock.ts` only.
**Out of scope**: `enable`/`disable`/the `visibilitychange` effect logic, and the
driver UI. Only `acquire` gains a guard.

## Git workflow

- Branch: `advisor/007-wake-lock-reacquire-guard`.
- One commit: `fix: don't re-request wake lock while one is already held`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## Steps

### Step 1: Skip re-acquire when a sentinel is already held

Add an early return at the top of `acquire`, after the `wantRef` check:

```ts
  const acquire = useCallback(async () => {
    if (!wantRef.current) return
    if (sentinelRef.current) return // already holding a live lock; OS release nulls this
    try {
      const sentinel = await navigator.wakeLock.request("screen")
      sentinelRef.current = sentinel
      setActive(true)
      sentinel.addEventListener("release", () => {
        sentinelRef.current = null
        setActive(false)
      })
    } catch {
      setActive(false)
    }
  }, [])
```

**Verify**: `pnpm exec tsc --noEmit` → only known `calendar.tsx` error;
`pnpm lint` → exit 0.

### Step 2: Manual sanity (optional — needs a wake-lock-capable browser over HTTPS)

If you can run the driver page over HTTPS in Chrome: enable tracking (lock
acquired, `active` true), switch tabs away and back several times, and confirm the
screen still stays awake and no errors appear. The lock should re-acquire after a
real hide/show, and rapid focus toggles should not spawn extra locks. If you can't
run it, the type/lint gates plus the reasoning in "Current state" are sufficient;
note acceptance as unverified.

**Verify**: no console errors; screen stays awake after tab switches.

## Test plan

No automated suite (and wake lock is hard to unit-test without a DOM/permission
mock). Verification is typecheck + lint, plus the optional manual check in Step 2.

## Done criteria

ALL must hold:

- [ ] `acquire` returns early when `sentinelRef.current` is non-null.
- [ ] `pnpm exec tsc --noEmit` exits 0 (except known error); `pnpm lint` exits 0.
- [ ] No other function in the file changed (`git diff` shows only the guard line).
- [ ] `plans/README.md` 007 row updated.

## STOP conditions

- The `release` listener no longer nulls `sentinelRef.current` in the live code
  (someone changed it) — then "ref non-null" no longer means "held" and the guard
  would wrongly block re-acquire after a real release. Report instead of adding
  the guard.

## Maintenance notes

- The guard's correctness hinges on the `release` listener nulling
  `sentinelRef.current`. If that listener is ever removed or changed, revisit this
  guard in the same edit.
