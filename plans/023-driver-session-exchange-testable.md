# Plan 023: Make the driver-login exchange testable by extracting it from the worker

> **HISTORICAL COMPLETED PLAN — DO NOT EXECUTE.** Implemented in `3c8fb89`.
> Local-verification excerpts below record the pre-cutover implementation and
> were superseded by the 2026-07-31 cutover design.

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat a0e0283..HEAD -- workers/driver-session.ts lib/driver-auth/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (independent of plan 022 — different files)
- **Category**: tests
- **Planned at**: commit `a0e0283`, 2026-07-28

## Why this matters

`workers/driver-session.ts` is the login path for every delivery driver: it
takes a token from a third-party system (Bubble Box, "BB"), maps it to a
vehicle, provisions a user if needed, and mints a session. It is 224 lines,
it is live in production, and **it has zero tests**. It cannot have tests in
its current shape: it reads environment variables and throws at module scope,
constructs a privileged database client at module scope, and calls
`server.listen()` at module scope. Importing it from a test executes all
three.

This matters right now because the verification step inside that file is about
to be rewritten — BB is replacing local token verification with a call to their
own endpoint. That rewrite will touch the login path with no regression net
underneath it, and the only current proof that login works is manually curling
a live server.

This plan extracts the decision logic — token to session, including every
failure branch — into `lib/driver-auth/exchange.ts` with its dependencies
injected, and unit-tests all nine branches. Behaviour does not change. The
worker keeps the HTTP server, the environment reading, and the database client;
it just delegates the thinking. After this lands, the verification swap is a
change to one injected dependency with tests already asserting that every
surrounding branch still behaves.

**This plan does not change how tokens are verified.** See "Out of scope".

## Current state

### Files

- `workers/driver-session.ts` — the exchange service. Runs as its own container
  in production behind one Caddy route. Contains everything: env, HTTP server,
  database access, and the logic this plan extracts.
- `lib/driver-auth/verify.ts` — token verification (38 lines). Already
  extracted, already unit-tested at `lib/driver-auth/verify.test.ts`. **This is
  the structural precedent**: decision logic lives in `lib/`, the loop and the
  I/O live in `workers/`. This plan finishes that job for the rest of the flow.

### Why the worker cannot be imported today

`workers/driver-session.ts:28-48`:

```ts
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY
const PUBLIC_KEY_B64 = process.env.BB_DRIVER_JWT_PUBLIC_KEY_B64
const PORT = Number(process.env.DRIVER_SESSION_PORT ?? 3100)
const MAX_BODY_BYTES = 16_384

if (!SUPABASE_URL || !SECRET_KEY || !PUBLIC_KEY_B64) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "BB_DRIVER_JWT_PUBLIC_KEY_B64 (base64-encoded PEM)."
  )
}

const publicKeyPem = Buffer.from(PUBLIC_KEY_B64, "base64").toString("utf8")

// Admin client: service-key PostgREST + auth admin. Never let a user session
// attach to this client — verifyOtp runs on a throwaway client instead, or
// every later .from() call would silently run as that driver.
const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
```

and `workers/driver-session.ts:222-224`:

```ts
server.listen(PORT, () => {
  log("info", "startup", { port: PORT, supabase: SUPABASE_URL })
})
```

A test that does `import { exchange } from "../workers/driver-session"` would
throw on missing env, then bind a TCP port. That is the whole reason this file
is untested.

### The logic being extracted

`workers/driver-session.ts:137-182`, verbatim — this is the function that moves:

```ts
async function exchange(token: string): Promise<
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 403; body: { error: string } }
> {
  let riderId: string
  try {
    ;({ riderId } = await verifyRiderToken(token, publicKeyPem))
  } catch (err) {
    if (err instanceof TokenInvalidError || err instanceof NotARiderTokenError) {
      log("warn", "token_rejected", { reason: err.message })
      return { status: 401, body: { error: "invalid token" } }
    }
    throw err
  }

  const vehicle = await findVehicle(riderId)
  if (!vehicle) {
    log("warn", "unmapped_rider", { rider: riderId })
    return { status: 403, body: { error: "no vehicle mapped for this rider" } }
  }

  let email: string
  if (vehicle.assigned_user_id) {
    const { data, error } = await admin.auth.admin.getUserById(
      vehicle.assigned_user_id
    )
    if (error) throw new Error(`user lookup failed: ${error.message}`)
    if (!data.user.email) throw new Error("assigned driver user has no email")
    email = data.user.email
  } else {
    ;({ email } = await ensureDriverUser(vehicle.id, riderId))
    log("info", "driver_autoprovisioned", { rider: riderId })
  }

  const session = await mintSession(email)
  log("info", "session_minted", { rider: riderId })
  return {
    status: 200,
    body: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
    },
  }
}
```

Its collaborators, which stay in the worker and become injected dependencies:

- `findVehicle(riderId)` — `workers/driver-session.ts:70-80`, reads
  `vehicles` by `rider_ref`, returns `{ id, assigned_user_id } | null`.
- `ensureDriverUser(vehicleId, riderId)` — `:86-114`, creates the Auth user if
  absent and claims the vehicle; returns `{ userId, email }`.
- `mintSession(email)` — `:116-135`, admin magiclink + `verifyOtp`, returns a
  Supabase session.
- `log(level, event, fields)` — `:50-64`, one JSON line per event.
- `admin.auth.admin.getUserById(...)` — used inline at `:160`.

### Behaviours that must be preserved exactly

These are the contract with the driver app, documented at
`docs/driver-session-api.md:43-48`. Getting one wrong breaks a real client:

1. A verification failure of **either** kind (`TokenInvalidError` or
   `NotARiderTokenError`) returns `401 { error: "invalid token" }`. The two are
   deliberately indistinguishable to the caller.
2. Any **other** error from verification is re-thrown (`throw err` above), not
   converted to a 401. It reaches the server's catch handler at
   `workers/driver-session.ts:213-218` and becomes a `500`. This distinction —
   "the token is bad" vs "we are broken" — is the single most important branch
   in the file and is currently asserted by nothing.
3. A rider with no matching vehicle returns
   `403 { error: "no vehicle mapped for this rider" }`.
4. A vehicle with no `assigned_user_id` auto-provisions a driver on first
   login, then proceeds to mint. A vehicle that already has one looks up that
   user's email instead.
5. An assigned user without an email throws (→ 500). It never silently
   provisions a second user.
6. The 200 body carries exactly `access_token`, `refresh_token`, `expires_in`,
   `expires_at` — no more (do not leak the whole session object).
7. Log events keep their exact names: `token_rejected`, `unmapped_rider`,
   `driver_autoprovisioned`, `session_minted`.

### Repo conventions you must match

**Style**: no semicolons, double quotes, 2-space indent, named exports.

**Dependency injection instead of mocking.** This repo has **no mocking at
all** — `vi.mock`, `vi.fn` and `vi.spyOn` appear in zero test files. The
established pattern is to accept collaborators as plain function parameters.
Exemplar, `lib/settings/storage.ts:17`:

```ts
export function loadSettings(get: (k: string) => string | null): Settings {
```

tested at `lib/settings/storage.test.ts:5-12` with a plain function:

```ts
function fromMap(m: Record<string, string>) {
  return (k: string) => (k in m ? m[k] : null)
}

describe("loadSettings", () => {
  it("empty storage → defaults", () => {
    expect(loadSettings(() => null)).toEqual(DEFAULT_SETTINGS)
  })
```

A second exemplar takes an injected function as the second parameter:
`buildConsoleVehicles(input, t)` at `lib/console/use-console-data.ts:59`.

**Do not import `vi`. Do not add a mocking library.**

**Test conventions** (from `lib/driver-auth/verify.test.ts`): explicit
`import { describe, expect, it } from "vitest"`, one top-level `describe` named
after the exported symbol, lowercase verb-first titles with an optional
parenthetical rationale, async errors asserted with
`await expect(...).rejects.toBeInstanceOf(...)` — for example
`lib/driver-auth/verify.test.ts:52`:

```ts
await expect(verifyRiderToken(token, publicKeyPem)).rejects.toBeInstanceOf(
  NotARiderTokenError
)
```

**Deployment note (no action needed)**: `Dockerfile:32-43` bundles the workers
with esbuild from both `workers/` and `lib/`, so a new module under `lib/` is
picked up with no Dockerfile or compose change. Do not edit them.

## Commands you will need

| Purpose   | Command                                     | Expected on success             |
|-----------|---------------------------------------------|---------------------------------|
| Install   | `pnpm install`                              | exit 0                          |
| Typecheck | `pnpm exec tsc --noEmit`                    | exit 0, no output               |
| Tests     | `pnpm test`                                 | all pass (120 before this plan) |
| One suite | `pnpm exec vitest run lib/driver-auth`      | all pass                        |
| Build     | `pnpm build`                                | exit 0                          |

**Lint note**: `pnpm lint` is already red repo-wide for unrelated pre-existing
reasons (documented in `plans/README.md`). Do not fix that; only confirm you
added no new errors.

**Shell note**: this repo is developed on Windows. The inline
environment-variable prefix in step 4 (`DRIVER_SESSION_PORT=3199 pnpm
driver-session`) is POSIX syntax — run it in Git Bash. In PowerShell the
equivalent is `$env:DRIVER_SESSION_PORT = "3199"; pnpm driver-session`.

## Scope

**In scope** (the only files you should modify or create):

- `lib/driver-auth/exchange.ts` (create)
- `lib/driver-auth/exchange.test.ts` (create)
- `workers/driver-session.ts` (modify — delegate to the new module)

**Out of scope** (do NOT touch, even though they look related):

- **`lib/driver-auth/verify.ts` and `verify.test.ts`.** Verification is being
  replaced by a different mechanism in a future plan, on a schedule owned by a
  third party. Changing it here would collide with that work. This plan treats
  verification as an opaque injected function — which is precisely what makes
  the later swap cheap.
- `scripts/gen-driver-test-token.ts`, `.driver-auth-dev/`, and the
  `BB_DRIVER_JWT_PUBLIC_KEY_B64` environment variable. All of these are tied to
  the current verification mechanism and will be retired with it. Leave them.
- `docs/driver-session-api.md` — the client-facing contract. This plan changes
  no observable behaviour, so the document stays correct as written. Do not
  "improve" it.
- The HTTP server block (`workers/driver-session.ts:184-224`): body-size cap,
  405/413/400 handling, and the 500 catch. Leave the transport alone.
- `workers/bubblebox-sync.ts` — a different worker with the same shape problem.
  It is out of scope here; see "Maintenance notes".
- Do **not** deduplicate the `log()` helper that both workers define
  identically. It is real duplication, but moving it is a separate change and
  would enlarge this diff for no test benefit.

## Git workflow

- Branch: `advisor/023-driver-session-exchange-testable`
- Conventional Commits with a scope, lowercase subject, no trailing period.
  Real examples from `git log`: `feat(auth): driver session exchange — one
  login, no driver passwords`, `fix(docker): worker containers never started`.
  Suggested: `refactor(auth): extract the driver-session exchange into lib/`.
- **Do not add a `Co-Authored-By` trailer or any AI-authorship trailer.**
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `lib/driver-auth/exchange.ts`

Move the body of `exchange()` verbatim, replacing each collaborator with a
member of an injected `deps` object. Target surface:

```ts
export type ExchangeSession = {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: number
}

export type ExchangeVehicle = {
  id: string
  assigned_user_id: string | null
}

export type ExchangeDeps = {
  /** Verify the caller's token and return the rider identity. */
  verifyToken: (token: string) => Promise<{ riderId: string }>
  /** True when the error means "the token is bad" (→ 401), not "we broke". */
  isTokenRejection: (err: unknown) => boolean
  findVehicle: (riderId: string) => Promise<ExchangeVehicle | null>
  emailForUser: (userId: string) => Promise<string>
  provisionDriver: (vehicleId: string, riderId: string) => Promise<string>
  mintSession: (email: string) => Promise<ExchangeSession>
  log: (
    level: "info" | "warn" | "error",
    event: string,
    fields?: Record<string, unknown>
  ) => void
}

export type ExchangeResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 403; body: { error: string } }

export async function exchangeRiderToken(
  token: string,
  deps: ExchangeDeps
): Promise<ExchangeResult>
```

Notes on the shape, so you do not have to guess:

- `isTokenRejection` exists so this module never imports the current error
  classes. That import is exactly the coupling the later verification swap has
  to break. The worker supplies
  `(err) => err instanceof TokenInvalidError || err instanceof NotARiderTokenError`.
- `provisionDriver` returns just the email — the caller never used `userId`.
- `emailForUser` throws when the user is missing or has no email; the worker
  keeps the two existing message strings (`user lookup failed: …`,
  `assigned driver user has no email`).
- Keep the log event names and field shapes byte-identical (`{ reason }`,
  `{ rider }`).
- The module must not import `@supabase/supabase-js`, must not read
  `process.env`, and must not construct anything at module scope.

**Verify**:
- `pnpm exec tsc --noEmit` → exit 0
- `grep -c "supabase\|process.env" lib/driver-auth/exchange.ts` → `0`

### Step 2: Rewire `workers/driver-session.ts`

Replace the local `exchange()` (lines 137–182) with a `deps` object built from
what the worker already has, and call the new function. Target shape:

```ts
const deps: ExchangeDeps = {
  verifyToken: (token) => verifyRiderToken(token, publicKeyPem),
  isTokenRejection: (err) =>
    err instanceof TokenInvalidError || err instanceof NotARiderTokenError,
  findVehicle,
  emailForUser: async (userId) => {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error) throw new Error(`user lookup failed: ${error.message}`)
    if (!data.user.email) throw new Error("assigned driver user has no email")
    return data.user.email
  },
  provisionDriver: async (vehicleId, riderId) =>
    (await ensureDriverUser(vehicleId, riderId)).email,
  mintSession,
  log,
}
```

and at the call site (currently `workers/driver-session.ts:211`):

```ts
exchangeRiderToken(token, deps)
  .then((r) => respond(r.status, r.body))
  .catch((err) => { /* unchanged */ })
```

Keep `findVehicle`, `ensureDriverUser`, `mintSession`, `log`, the env block,
the admin client, and the whole server block exactly as they are.

**Verify**:
- `pnpm exec tsc --noEmit` → exit 0
- `grep -n "async function exchange" workers/driver-session.ts` → no matches
- `grep -n "exchangeRiderToken" workers/driver-session.ts` → 2 matches (import
  and call site)

### Step 3: Write `lib/driver-auth/exchange.test.ts`

Build fake deps as a plain object with a `Partial<ExchangeDeps>` override
factory — the fixture idiom used at `lib/bubblebox/translate.test.ts:10-19`.
Sketch:

```ts
class FakeRejection extends Error {}

const deps = (over: Partial<ExchangeDeps> = {}): ExchangeDeps => ({
  verifyToken: async () => ({ riderId: "6" }),
  isTokenRejection: (err) => err instanceof FakeRejection,
  findVehicle: async () => ({ id: "v1", assigned_user_id: "u1" }),
  emailForUser: async () => "rider-6@driver.fleetmap.internal",
  provisionDriver: async () => "rider-6@driver.fleetmap.internal",
  mintSession: async () => ({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    expires_at: 1_900_000_000,
  }),
  log: () => {},
  ...over,
})
```

Record log calls where a test asserts them by passing a `log` that pushes into
a local array — no spy library.

Cover exactly these cases inside `describe("exchangeRiderToken", …)`:

1. existing driver → `200`, and the body has exactly the four session keys
   (assert with `Object.keys(...).sort()` so an accidental extra field fails)
2. a rejected token → `401 { error: "invalid token" }`, and `token_rejected`
   was logged
3. a **non**-rejection error from `verifyToken` propagates — assert
   `await expect(exchangeRiderToken("t", deps({ verifyToken: async () => { throw new Error("boom") } }))).rejects.toThrow(/boom/)`.
   **This is the most important test in the file**: it pins the "broken" vs
   "bad token" distinction that becomes load-bearing when verification moves
   over the network and starts failing for infrastructure reasons.
4. unmapped rider (`findVehicle` → `null`) → `403` with the exact documented
   message, and `unmapped_rider` logged
5. vehicle without `assigned_user_id` → calls `provisionDriver` with
   `(vehicle.id, riderId)`, logs `driver_autoprovisioned`, and still returns
   `200`
6. vehicle **with** `assigned_user_id` → `emailForUser` is called and
   `provisionDriver` is **not** (assert with a flag set inside the fake)
7. `emailForUser` throwing propagates (→ the worker's 500 path), and
   `mintSession` is never called
8. the email resolved from the vehicle is the one passed to `mintSession`
   (assert the captured argument) — this is what stops a driver being minted a
   session for someone else's identity
9. `session_minted` is logged with `{ rider: "6" }` on the happy path

**Verify**: `pnpm exec vitest run lib/driver-auth` → all pass; `exchange.test.ts`
reports 9 tests and `verify.test.ts` still reports its original 7.

### Step 4: Full verification

- `pnpm exec tsc --noEmit` → exit 0
- `pnpm test` → all pass, and `exchange.test.ts` reports 9 passing tests. The
  repo-wide total was 120 before this plan, so expect **at least** 129 — it
  will be higher if plan 022 or 024 landed first. Do not treat a higher total
  as a failure.
- `pnpm build` → exit 0
- Boot check (proves the worker still starts and its module graph is intact):
  `DRIVER_SESSION_PORT=3199 pnpm driver-session` → prints one JSON line with
  `"event":"startup"`. Stop it with Ctrl-C. If your shell has no `.env` with
  the three required variables it will instead print the `Missing env` error
  from line 35 — that is also an acceptable pass for this step, because it
  proves module evaluation reached the env guard rather than failing on an
  import error.

## Test plan

- **New file**: `lib/driver-auth/exchange.test.ts` — the 9 cases above.
- **Structural pattern**: `lib/driver-auth/verify.test.ts` (same directory,
  same describe/it style, `.rejects` for async errors).
- **Fixture pattern**: the `Partial<T>` override factory at
  `lib/bubblebox/translate.test.ts:10-19`.
- **Injection pattern**: `lib/settings/storage.test.ts:5-12` — plain functions,
  no mocking library.
- **Existing tests must not change.** Any failure in an existing suite is a
  STOP condition; this plan is behaviour-preserving.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0, with 9 passing tests in
      `lib/driver-auth/exchange.test.ts`, the 7 in `verify.test.ts` still
      passing, and no previously-passing test now failing
- [ ] `pnpm build` exits 0
- [ ] `lib/driver-auth/exchange.ts` and `lib/driver-auth/exchange.test.ts` exist
- [ ] `grep -n "supabase" lib/driver-auth/exchange.ts` → no matches
- [ ] `grep -n "process.env" lib/driver-auth/exchange.ts` → no matches
- [ ] `grep -rn "vi\.\(mock\|fn\|spyOn\)" lib/driver-auth/` → no matches
- [ ] `git diff --stat a0e0283..HEAD -- lib/driver-auth/verify.ts` → empty
      (verification was not touched)
- [ ] `git status --short` shows only the three in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" do not match the live code — in particular if
  `lib/driver-auth/verify.ts` no longer exports `TokenInvalidError` /
  `NotARiderTokenError`, which would mean the verification swap already
  happened and this plan needs rewriting against the new shape.
- You conclude the extraction requires changing an observable status code or
  response body. It does not; this is a pure move. If it seems to, you have
  misread a branch — stop.
- A test needs `vi` or a mocking library to pass.
- `pnpm test` shows any pre-existing test failing after your change.

## Maintenance notes

- **What this unblocks**: when Bubble Box publishes their verification
  endpoint, the change is to swap the `verifyToken` and `isTokenRejection`
  dependencies the worker supplies. Tests 1, 2, 4, 5, 6, 8 and 9 keep passing
  untouched and prove the surrounding flow did not regress; test 3 becomes the
  guard that a network failure against BB does not get misreported to drivers
  as "invalid token" — which is the specific way that swap can go wrong.
- **What a reviewer should scrutinise**: that the `throw err` re-throw path
  survived the move intact (it is the one branch that is easy to "tidy" into a
  401 by accident), and that the 200 body still lists exactly four fields.
- **Deliberately deferred**: the same shape problem in
  `workers/bubblebox-sync.ts` (module-scope env, `void main()` at line 253,
  untested loop), and the duplicated `log()` helper both workers define. Worth
  doing, not worth widening this diff.
- **Not covered by tests**: the real Supabase admin calls
  (`getUserById`, `generateLink`, `verifyOtp`) and the HTTP transport. Those
  stay proven the way they are proven today — by running the exchange against
  a live stack. `docs/HANDOFF.md` records how that was done for the M20
  rollout.
