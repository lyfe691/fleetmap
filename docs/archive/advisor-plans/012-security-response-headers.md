# Plan 012: Add production security response headers (CSP scoped to Supabase + MapTiler)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat a8b6215..HEAD -- next.config.ts`
> If `next.config.ts` changed since this plan was written, reconcile before
> proceeding.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED (a too-strict CSP can break map tiles, fonts, or the Realtime
  WebSocket — this plan verifies against the running app before claiming done)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a8b6215`, 2026-06-22

## Why this matters

`next.config.ts` is empty and there is no `middleware.ts`, so the app ships no
security response headers. The dashboard is a long-lived browser surface that
loads third-party map tiles and holds an authenticated Supabase session; basic
hardening (clickjacking protection, MIME-sniff protection, a scoped
Content-Security-Policy) is cheap defense-in-depth and expected for anything
heading toward production — especially as the app gains a touchscreen UI that may
be more exposed. React's auto-escaping is not a substitute for a CSP.

## Current state

`next.config.ts` in full:

```ts
import type { NextConfig } from "next"

const nextConfig: NextConfig = {}

export default nextConfig
```

External origins the app legitimately talks to (these MUST be allowed by the CSP
or the app breaks):
- **Supabase**: `https://<project>.supabase.co` over HTTPS (REST/Auth) **and**
  `wss://<project>.supabase.co` (Realtime WebSocket). The project URL is in
  `NEXT_PUBLIC_SUPABASE_URL`. Use a wildcard `https://*.supabase.co` +
  `wss://*.supabase.co` so the policy is env-agnostic.
- **MapTiler**: tiles/style/fonts/sprites from `https://api.maptiler.com`
  (style URL is `https://api.maptiler.com/maps/streets-v2/style.json?key=...`).
- MapLibre GL uses Web Workers created from blob URLs and draws to canvas —
  `worker-src blob:` and `child-src blob:` are required, and `img-src` must allow
  `data:` and `blob:`.

Convention: keep config minimal; no secrets in the file (the CSP references
origins, never keys). `pnpm build` and `pnpm exec tsc --noEmit` are the gates.

## Commands you will need

| Purpose   | Command                          | Expected on success      |
|-----------|----------------------------------|--------------------------|
| Typecheck | `pnpm exec tsc --noEmit`         | exit 0, no errors        |
| Build     | `pnpm build`                     | exit 0                   |
| Dev       | `pnpm dev` + `pnpm fake-gps`     | map + Realtime work      |
| Headers   | `curl -sI http://localhost:3000/dashboard` | shows the headers |

## Scope

**In scope**:
- `next.config.ts` — add an async `headers()` returning the header set below

**Out of scope** (do NOT touch):
- Any route handler, auth flow, or RLS — this is transport hardening only.
- Cookie attributes (the app uses bearer tokens in memory, not auth cookies).
- A nonce-based strict CSP — out of scope; this plan ships a pragmatic policy.
  Tightening `script-src` (removing `'unsafe-inline'`) is a deferred follow-up.

## Git workflow

- Branch: `advisor/012-security-headers`
- Conventional commit (e.g. `feat(security): add response security headers + CSP`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the `headers()` config

Edit `next.config.ts` to apply these headers to all routes:

```ts
import type { NextConfig } from "next"

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://api.maptiler.com",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.maptiler.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'self' data: https://api.maptiler.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ")

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ]
  },
}

export default nextConfig
```

Note: `'unsafe-eval'`/`'unsafe-inline'` in `script-src` are pragmatic — MapLibre
and Next's dev/runtime may need them. Tightening is the deferred follow-up.

**Verify**: `pnpm exec tsc --noEmit` exit 0; `pnpm build` exit 0.

### Step 2: Verify the app still works under the CSP

Run `pnpm dev` + `pnpm fake-gps`, open `/dashboard`, enter the display code.
With DevTools console open, confirm **zero** CSP violation errors and that:
- the map tiles/style load (no blank/grey canvas),
- vehicle markers move (Realtime WebSocket connected — check the Network tab for
  a `wss://*.supabase.co` connection in `101 Switching Protocols`),
- the route lines render.

Also check `/driver` loads without CSP violations.

**Verify**: no CSP violations in console; map, Realtime, and routes all work.

### Step 3: Confirm headers are present

`curl -sI http://localhost:3000/dashboard` (dev) — confirm
`content-security-policy`, `x-content-type-options: nosniff`,
`x-frame-options: DENY`, and `referrer-policy` appear.

**Verify**: all four headers present in the response.

## Test plan

No unit tests (this is HTTP-layer config). Verification is the build gate plus
the runtime CSP check in Step 2 and the header check in Step 3. If a CSP
violation appears, read the violated directive from the console message and add
the specific origin — do **not** broaden to `*` or delete the directive.

## Done criteria

ALL must hold:

- [ ] `next.config.ts` exports a `headers()` config with CSP + the three static
      headers
- [ ] `pnpm build` exit 0; `pnpm exec tsc --noEmit` exit 0
- [ ] `/dashboard` and `/driver` load with **no** CSP violations; tiles,
      Realtime motion, and routes work (Step 2)
- [ ] `curl -sI` shows the four headers (Step 3)
- [ ] No files outside `next.config.ts` modified
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

Stop and report if:

- After allowing Supabase + MapTiler origins, the map or Realtime still breaks
  under the CSP and the violated origin is something unexpected (don't broaden to
  `*` to make it pass — report the origin).
- The app needs an inline script with a hash/nonce you can't express here —
  report; a nonce-based policy is a separate, larger change.

## Maintenance notes

- The CSP uses `https://*.supabase.co` / `wss://*.supabase.co` so it survives a
  project/env change without edits. If the app moves to a **self-hosted**
  Supabase (a stated handoff option), update `connect-src` to that origin.
- Deferred follow-up: remove `'unsafe-inline'`/`'unsafe-eval'` from `script-src`
  via a nonce-based CSP once the app's inline-script needs are characterized.
- Reviewer should confirm no secret/key appears in `next.config.ts` (origins
  only) and that Step 2's runtime check was actually performed, not assumed.
