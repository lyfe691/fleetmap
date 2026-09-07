# Plan 017: Surface dashboard session death on the long-running TV instead of silently freezing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 3f5e84b..HEAD -- lib/use-live-vehicles.ts`
> If `lib/use-live-vehicles.ts` changed since this plan was written, compare the
> "Current state" excerpt against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3f5e84b`, 2026-06-23

## Why this matters

The dashboard is designed to run unattended on a wall-mounted TV for days. Its
Supabase session is minted server-side once (behind the display code) and then
auto-refreshed by `supabase-js`. The live hook re-arms Realtime auth on
`TOKEN_REFRESHED`, but it handles **only** that event. If the session ultimately
ends — the refresh token expires or is revoked after long uptime — `supabase-js`
emits `SIGNED_OUT`, the Realtime channel loses auth and stops delivering, and the
dashboard **keeps displaying the last-known positions with no error**. An
operator walking past sees vans that look live but are frozen. This is the most
consequential failure mode for the product's core use case (a trustworthy TV),
and today it's invisible. The fix surfaces it through the error banner the shell
already renders.

## Current state

```ts
// lib/use-live-vehicles.ts:60-65 — only TOKEN_REFRESHED is handled
// Re-arm Realtime when supabase-js refreshes the session, so the socket
// stays authed and the channel keeps delivering on a long-running TV.
const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED" && session) {
    void supabase.realtime.setAuth(session.access_token)
  }
})
```

The surrounding effect already owns:
- a `cancelled` flag (set in cleanup at `:153`) used to guard all `setState` calls,
- a `setError(...)` setter whose value is rendered by the shell.

The shell renders any non-null `error` as a banner *over* the (possibly stale)
data, with a "Change code" button that clears the stored code and reloads:

```tsx
// components/console/console-shell.tsx:110-124
{error ? (
  <div className="absolute top-4 left-1/2 z-20 …">
    <span className="text-destructive">{error}</span>
    <Button variant="outline" size="sm" onClick={() => { clearDisplayCode(); window.location.reload() }}>
      Change code
    </Button>
  </div>
) : null}
```

So setting `error` on session death is enough to make the failure visible and give
the operator a one-click recovery (reload re-mints from the still-stored code; or
"Change code" to re-enter).

Note: the dashboard uses `getBrowserClient()` (`lib/supabase/browser.ts`). The
driver app uses a *different* client (`getDriverClient()`), and `signOut()` is
only called in the driver UI — so on the browser client, `SIGNED_OUT` reliably
means a genuine dashboard session death, not a user action.

**Repo conventions**: this hook returns `{ vehicles, error, ready, loaded }` and
drives all dashboard UI off those. Keep the single `error` channel; do not add a
parallel status field. All `setState` after async work is guarded by `cancelled`.

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
- `lib/use-live-vehicles.ts`

**Out of scope** (do NOT touch):
- `lib/use-live-stops.ts` — it rides the same socket; once the vehicles hook
  surfaces the error, the shell banner already covers the whole console. Do not
  duplicate the handler there.
- The auto-refresh / `TOKEN_REFRESHED` behavior — leave it exactly as is.
- `components/console/console-shell.tsx` — it already renders `error`; no change
  needed.

## Git workflow

- Branch: `advisor/017-tv-session-death-surfacing`
- Commit message style: conventional commits, e.g.
  `fix(dashboard): surface SIGNED_OUT so a dead TV session isn't silent`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Handle `SIGNED_OUT` in the auth-state handler

In `lib/use-live-vehicles.ts`, extend the `onAuthStateChange` callback:

```ts
const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED" && session) {
    void supabase.realtime.setAuth(session.access_token)
  } else if (event === "SIGNED_OUT") {
    // The long-running dashboard session ended (refresh token expired/revoked).
    // Surface it so the TV shows the error banner instead of silently freezing
    // on stale positions. Recovery is a reload (re-mints from the stored code).
    if (!cancelled) setError("Session ended — reload to reconnect.")
  }
})
```

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0.

### Step 2: Confirm the `cancelled` guard and event name

- Confirm `cancelled` is in scope at the handler (it is declared in the same
  effect, `:54`). The guard prevents a setState-after-unmount warning.
- Confirm the event string is exactly `"SIGNED_OUT"` (supabase-js
  `AuthChangeEvent`). If your installed `@supabase/supabase-js` types reject that
  literal, STOP and report (version drift).

**Verify**: `corepack pnpm exec tsc --noEmit` → exit 0; `corepack pnpm test` → all pass.

## Test plan

This is Realtime/auth wiring inside a Supabase-bound hook; the repo has no harness
to render it and adding one is out of scope. Rely on `tsc` + code review, and
document a manual check in the PR description:

- **Forced check**: in the browser devtools console on `/dashboard`, run
  `await window.__supabaseSignOutForTest?.()` if such a hook exists, OR simply
  call `supabase.auth.signOut()` on the browser client (temporarily exposed) and
  confirm the red "Session ended — reload to reconnect." banner appears over the
  still-rendered (now frozen) map. Reloading reconnects without re-entering the
  code.

If you cannot trigger `SIGNED_OUT` manually, at minimum confirm via code review
that the new branch is reachable and guarded, and note in the PR that runtime
confirmation is pending.

## Done criteria

ALL must hold:

- [ ] `corepack pnpm exec tsc --noEmit` exits 0
- [ ] `corepack pnpm test` exits 0 (count unchanged, all green)
- [ ] `grep -n 'SIGNED_OUT' lib/use-live-vehicles.ts` shows the new branch
- [ ] The new `setError` is guarded by `if (!cancelled)`
- [ ] `TOKEN_REFRESHED` handling is unchanged (`git diff` review)
- [ ] No files outside `lib/use-live-vehicles.ts` are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `onAuthStateChange` excerpt doesn't match (drift).
- The installed `@supabase/supabase-js` types don't accept `"SIGNED_OUT"` as an
  `AuthChangeEvent` literal (version mismatch).
- You discover `signOut()` is being called somewhere on the browser client during
  normal dashboard operation (which would make `SIGNED_OUT` fire spuriously) —
  report it; the assumption that `SIGNED_OUT` ⇒ genuine death would be false.

## Maintenance notes

- **Follow-up (deferred, not in this plan):** make the TV *self-heal* — on
  `SIGNED_OUT`, automatically re-mint the dashboard session from the stored
  display code (re-run the hook's `start()` / `setSession` + `realtime.setAuth`)
  instead of requiring a manual reload. Worthwhile for a truly unattended TV, but
  riskier (re-entrancy with the existing channel) — do it as its own plan with a
  test/verification story.
- A reviewer should confirm `useLiveStops` did not also need a handler (it
  shares the socket; the shell banner covers both).
