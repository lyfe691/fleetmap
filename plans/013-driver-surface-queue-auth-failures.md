# Plan 013: Driver surfaces IndexedDB/queue + auth-refresh failures instead of losing GPS silently

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3f5e84b..HEAD -- lib/use-location-sync.ts lib/location-queue.ts components/driver/driver-app.tsx`
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

The driver PWA's entire job is to stream GPS to the backend. Every fix is
enqueued into IndexedDB (`lib/location-queue.ts`) and a single-flight drain
sends them oldest-first. But the queue calls are made fire-and-forget
(`void submit(fix)`, `void drain()`) and **neither `submit()` nor `drain()` has
a `catch`**. If IndexedDB becomes unavailable — Safari private mode disables it,
quota-exceeded, store corruption, a failed DB open — every `enqueue`/`peekOldest`
throws, the rejection is swallowed, and the driver keeps "Tracking" with **no
indication that nothing is being saved or sent**. A driver could run a whole
shift producing zero data. Today the only failures the UI surfaces are
`no-vehicle` (409) and `auth` (401). After this plan, a storage/queue failure
shows a clear banner so the driver knows to act.

## Current state

- `lib/location-queue.ts` — thin IndexedDB wrapper (via `idb`). Every function
  (`enqueue`, `peekOldest`, `deleteKey`, `count`) does `await db()` then an IDB
  op; any of these can reject if IDB is unavailable. Excerpt:

  ```ts
  // lib/location-queue.ts:33-44
  export async function enqueue(point: QueuedPoint): Promise<void> {
    const d = await db()
    await d.add(STORE, point)
    // Ring-buffer: drop oldest beyond the cap so a long tunnel can't grow forever.
    let n = await d.count(STORE)
    while (n > MAX_PENDING) { ... }
  }
  ```

- `lib/use-location-sync.ts` — the sync hook. Three problem points:

  ```ts
  // lib/use-location-sync.ts:59
  type SyncError = "no-vehicle" | "auth" | null

  // lib/use-location-sync.ts:84-130 — drain(): try/finally with NO catch.
  const drain = useCallback(async () => {
    if (drainingRef.current || stoppedRef.current) return
    if (typeof navigator !== "undefined" && !navigator.onLine) return
    drainingRef.current = true
    try {
      const supabase = getDriverClient()
      for (;;) {
        const head = await peekOldest()          // <-- can throw (IDB)
        if (!head) break
        const { data } = await supabase.auth.getSession()
        let token = data.session?.access_token
        if (!token) break
        let result = await postPoint(head.point, token)
        if (result === "auth") {
          const refreshed = await supabase.auth.refreshSession()  // <-- can throw (network)
          token = refreshed.data.session?.access_token
          if (!token) { setError("auth"); break }
          result = await postPoint(head.point, token)
        }
        if (result === "ok" || result === "drop") {
          await deleteKey(head.key)              // <-- can throw (IDB)
          ...
        }
        ...
      }
    } finally {
      drainingRef.current = false
      await refreshQueued()                       // <-- can throw (IDB)
    }
  }, [refreshQueued])

  // lib/use-location-sync.ts:132-141 — submit(): no try/catch.
  const submit = useCallback(async (fix: Fix) => {
    lastEnqueuedPosRef.current = { lat: fix.lat, lng: fix.lng }
    lastEnqueuedAtRef.current = Date.now()
    await enqueue(fix)            // <-- can throw (IDB); rejection swallowed by `void submit`
    await refreshQueued()
    void drain()
  }, [drain, refreshQueued])

  // submit/drain are invoked fire-and-forget:
  //   :151  if (intervalOk && movedEnough) void submit(fix)
  //   :180  void submit(fix)            (heartbeat)
  //   :138/:161/:183/:187  void drain() (various)
  ```

- `components/driver/driver-app.tsx:116-124` — the consumer maps `sync.error`
  to a banner string:

  ```tsx
  const blocked = !geo.supported
    ? "This device has no geolocation."
    : geo.error === "denied"
      ? "Location permission denied — enable location for this site."
      : sync.error === "no-vehicle"
        ? "No vehicle is assigned to this account."
        : sync.error === "auth"
          ? "Session expired — sign out and back in."
          : null
  ```

**Repo conventions to match**: TypeScript throughout; hooks live in `lib/`,
return a small typed object. The existing error model is a single `SyncError`
union surfaced via the returned `error` field — extend that union, do not add a
parallel error channel. The existing `postPoint` already classifies HTTP
outcomes into a `PostResult` union (`lib/use-location-sync.ts:34-57`); follow
that same "narrow, typed result" style.

## Commands you will need

| Purpose   | Command                              | Expected on success      |
|-----------|--------------------------------------|--------------------------|
| Install   | `corepack pnpm install`              | exit 0                   |
| Typecheck | `corepack pnpm exec tsc --noEmit`    | exit 0, no errors        |
| Tests     | `corepack pnpm test`                 | all pass (40 + new)      |
| Lint      | `corepack pnpm lint`                 | no *new* errors (see note)|

> Note: `pnpm` is not on the non-interactive PATH in this environment; use
> `corepack pnpm …` (corepack ships with Node). `corepack pnpm lint` is already
> red repo-wide from a pre-existing `react-hooks/refs` posture — do not try to
> fix that; only ensure you add no *new* lint errors.

## Scope

**In scope** (the only files you should modify):
- `lib/use-location-sync.ts`
- `lib/use-location-sync.test.ts` (create)
- `components/driver/driver-app.tsx`

**Out of scope** (do NOT touch):
- `lib/location-queue.ts` — keep the queue functions throwing; this plan handles
  the throws at the call sites, it does not change the storage layer's contract.
- The drain ordering/single-flight logic — only wrap it; do not restructure the
  loop or change when drains fire.
- `app/api/location/route.ts` and the server side — unrelated.

## Git workflow

- Branch: `advisor/013-driver-surface-queue-auth-failures`
- Commit per logical unit; message style is conventional commits (see
  `git log --oneline`, e.g. `fix(driver): …`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extend the `SyncError` union with a storage failure case

In `lib/use-location-sync.ts`, change:

```ts
type SyncError = "no-vehicle" | "auth" | null
```
to:
```ts
type SyncError = "no-vehicle" | "auth" | "storage" | null
```

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0 (no usage yet, still compiles).

### Step 2: Catch storage failures in `submit()`

Wrap the body of `submit()` so an IDB throw sets `setError("storage")` instead of
becoming an unhandled rejection. Keep the happy path identical. Target shape:

```ts
const submit = useCallback(
  async (fix: Fix) => {
    lastEnqueuedPosRef.current = { lat: fix.lat, lng: fix.lng }
    lastEnqueuedAtRef.current = Date.now()
    try {
      await enqueue(fix)
      await refreshQueued()
      setError((e) => (e === "storage" ? null : e)) // clear a prior storage error on success
      void drain()
    } catch {
      setError("storage")
    }
  },
  [drain, refreshQueued]
)
```

(Use a functional `setError` update only if you keep the "clear on success"
behavior; the minimal version may simply `setError(null)` in a `try` that
succeeds — but do NOT clobber an active `no-vehicle`/`auth` error on a routine
success. The functional update above preserves those.)

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 3: Catch storage failures in `drain()`

`drain()` already has `try { … } finally { … }`. Add a `catch` between them so a
throw from `peekOldest`/`deleteKey`/`refreshQueued` (the IDB ops inside the loop)
surfaces as `"storage"` rather than escaping as an unhandled rejection. The
`finally` must still run. Target shape:

```ts
drainingRef.current = true
try {
  // ... existing loop unchanged ...
} catch {
  setError("storage")
} finally {
  drainingRef.current = false
  try {
    await refreshQueued()
  } catch {
    setError("storage")
  }
}
```

Note the `refreshQueued()` in `finally` is itself an IDB call — wrap it too so
the finally can't throw.

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 4: Surface the storage error in the driver UI

In `components/driver/driver-app.tsx`, add a branch to the `blocked` chain
(after the `auth` case, before the final `: null`):

```tsx
        : sync.error === "auth"
          ? "Session expired — sign out and back in."
          : sync.error === "storage"
            ? "Storage error — fixes can't be saved on this device. Try another browser or disable private mode."
            : null
```

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 5: Add a unit test proving storage errors surface (and don't crash)

Create `lib/use-location-sync.test.ts`. Because this hook is React + IDB heavy,
do NOT try to render it. Instead, refactor only if needed to test the
classification, OR — preferred, lower-risk — write a focused test that the
**error union and the driver-app mapping** include the new case. The cheapest
real assertion that catches regressions: a test that mocks `enqueue` to reject
and asserts the hook ends in `error === "storage"` using
`@testing-library/react`'s `renderHook` is ideal **only if that dep already
exists** — check `package.json`. If it does NOT exist, do not add it. Instead
add a pure-logic test of a small extracted helper:

- Extract the `blocked`-message mapping from `driver-app.tsx` into an exported
  pure function `syncBlockedMessage(args)` in a new small module
  `lib/driver-status.ts`, and test that `syncBlockedMessage({ error: "storage", … })`
  returns the storage string and that the other branches are unchanged.

Model the test file structure after `lib/geofence.test.ts` (same `vitest`
`describe`/`it`/`expect` style, `environment: "node"`).

**Verify**: `corepack pnpm test` → all pass, including the new test(s).

## Test plan

- New test file `lib/use-location-sync.test.ts` (or `lib/driver-status.test.ts`
  if you extract the helper): cover (a) storage error → storage message,
  (b) no-vehicle → existing message, (c) auth → existing message, (d) no error →
  `null`. This locks the mapping so a future refactor can't silently drop the
  storage case.
- Pattern to follow: `lib/geofence.test.ts`.
- Verification: `corepack pnpm test` → all pass, N new tests green.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0; new test(s) for the storage case exist and pass
- [ ] `grep -n '"storage"' lib/use-location-sync.ts` shows the union + both
      `setError("storage")` sites (submit + drain)
- [ ] `grep -n 'storage' components/driver/driver-app.tsx` shows the new banner branch
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `drain()`/`submit()`/`SyncError` code does not match the "Current state"
  excerpts (the file drifted since this plan was written).
- Adding `renderHook` would require installing `@testing-library/react` — do not
  install it; switch to the extracted-helper test approach instead.
- You find that catching in `drain()` changes the single-flight/ordering behavior
  in any way other than surfacing an error (it must not).

## Maintenance notes

- If a future change adds a persistent retry/backoff for storage errors, revisit
  whether `"storage"` should auto-clear (today it clears on the next successful
  `submit`).
- A reviewer should confirm the `finally` block can never throw (the wrapped
  `refreshQueued`) — an unhandled throw there would re-introduce the original bug.
- Deferred out of scope: telemetry/logging of storage failures. Note it for the
  team but do not add a logging dependency here.
