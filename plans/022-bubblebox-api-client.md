# Plan 022: Extract the Bubble Box API client out of the sync worker

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat a0e0283..HEAD -- workers/bubblebox-sync.ts lib/bubblebox/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `a0e0283`, 2026-07-28

## Why this matters

Fleetmap talks to a third-party system called Bubble Box (BB). Today exactly one
piece of code calls their API — the route-sync worker — and the HTTP client for
it (credential exchange, token caching, 401 re-mint) is written inline inside
that worker as module-level mutable state. A second consumer is now arriving:
the driver-login service must call a new BB endpoint, `/fleet/verify-token`,
which BB has confirmed uses **the same authentication** as the endpoint the sync
worker already calls. As written, that second consumer can only get an
authenticated BB call by duplicating the token dance or by importing from
`workers/`, which is not an importable module (it starts an infinite loop on
import — see "Current state").

This plan moves that client into `lib/bubblebox/client.ts` behind a small,
injectable interface, with unit tests. Nothing about behaviour changes. After
it lands, wiring the new endpoint is adding one function to a tested module
instead of re-implementing authentication in a second place.

**This plan deliberately does NOT implement `/fleet/verify-token`.** Its request
and response shape is still unknown and must not be guessed. See "Out of scope".

## Current state

### Files

- `workers/bubblebox-sync.ts` — the sync worker. Long-running loop that pulls
  BB routes every 60s and mirrors them into our database. Contains the BB HTTP
  client that this plan extracts (lines 30–42 and 166–201).
- `lib/bubblebox/translate.ts` — pure translation of BB's data shapes into ours.
  Already extracted, already unit-tested. **This is the structural precedent to
  follow**: `lib/bubblebox/` is where BB knowledge lives; `workers/` is where
  the loop lives.
- `lib/bubblebox/translate.test.ts` — the test file to model the new tests on.

Today `lib/bubblebox/` contains only `translate.ts` and `translate.test.ts`.
There is no HTTP code anywhere under `lib/` — all network calls to BB live in
`workers/`. That is what this plan changes.

### The code being moved

Configuration read at module scope, `workers/bubblebox-sync.ts:30-42`:

```ts
const API = process.env.FLEETMAP_API_URL ?? "http://localhost:3000"
const BB_API_URL = process.env.BB_API_URL
const BB_USERNAME = process.env.BB_API_USERNAME
const BB_PASSWORD = process.env.BB_API_PASSWORD
const FIXTURE = process.env.BB_FIXTURE_FILE
const SYNC_MS = Number(process.env.BB_SYNC_INTERVAL_MS ?? 60_000)

if (!FIXTURE && !(BB_API_URL && BB_USERNAME && BB_PASSWORD)) {
  throw new Error(
    "Set BB_API_URL + BB_API_USERNAME + BB_API_PASSWORD (real feed) " +
      "or BB_FIXTURE_FILE (dev)."
  )
}
```

The BB client itself, `workers/bubblebox-sync.ts:166-201` (verbatim):

```ts
// --- Bubble Box side ---------------------------------------------------------

let bbToken: string | null = null

async function mintBBToken(): Promise<string> {
  const res = await fetch(`${BB_API_URL}/api/v2/fleet/authentication-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: BB_USERNAME, password: BB_PASSWORD }),
  })
  if (!res.ok) throw new Error(`BB token denied (${res.status})`)
  const body = (await res.json()) as { data?: { loginToken?: string } }
  if (!body.data?.loginToken) {
    throw new Error("BB token response missing data.loginToken")
  }
  return body.data.loginToken
}

async function fetchStructure(date: string): Promise<BBRoute[]> {
  if (FIXTURE) {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as BBRoute[]
  }
  // Explicit bounds on both ends — their no-param default also means today,
  // but resolved in their server's idea of it.
  const url =
    `${BB_API_URL}/api/v2/fleet/rider-routes` +
    `?dueDate[notEarlier]=${date}&dueDate[notLater]=${date}`
  bbToken ??= await mintBBToken()
  let res = await fetch(url, { headers: { accessToken: bbToken } })
  if (res.status === 401) {
    bbToken = await mintBBToken()
    res = await fetch(url, { headers: { accessToken: bbToken } })
  }
  if (!res.ok) throw new Error(`BB routes fetch failed (${res.status})`)
  return (await res.json()) as BBRoute[]
}
```

Its only caller, `workers/bubblebox-sync.ts:205-206`:

```ts
async function tick(): Promise<void> {
  const structure = await fetchStructure(zurichToday())
```

Note the three behaviours that must be preserved exactly:

1. The token is minted lazily on first use (`??=`) and **cached across ticks**
   — it is valid ~24h, so re-minting every tick would be wrong.
2. A `401` triggers **exactly one** re-mint and **one** retry. A second 401
   surfaces as an error; it must not loop.
3. The auth header name is `accessToken` — not `Authorization`, not `Bearer`.
   This is BB's convention, verified against their shipped API.

### Why the worker cannot simply be imported

`workers/bubblebox-sync.ts` throws at module scope when env is missing
(lines 23–28 and 37–42) and calls `void main()` at line 253, which enters an
infinite `for(;;)` loop. Importing it from anywhere — including a test —
executes both. That is why the client must move to `lib/`, and it is why the
new module must not read `process.env` itself.

### Repo conventions you must match

**Style** (see any file in `lib/`): no semicolons, double quotes, 2-space
indent, named exports, `type` for object types. Do not add a formatter run.

**Dependency injection instead of mocking.** This repo has **no mocking
whatsoever** — `vi.mock`, `vi.fn`, and `vi.spyOn` appear in zero test files.
The established pattern is to accept the dependency as a plain function
parameter. The exemplar is `lib/settings/storage.ts:17`:

```ts
export function loadSettings(get: (k: string) => string | null): Settings {
```

tested at `lib/settings/storage.test.ts:5-12` by passing a plain function:

```ts
function fromMap(m: Record<string, string>) {
  return (k: string) => (k in m ? m[k] : null)
}

describe("loadSettings", () => {
  it("empty storage → defaults", () => {
    expect(loadSettings(() => null)).toEqual(DEFAULT_SETTINGS)
  })
```

Follow exactly this shape: the new client takes its `fetch` as an optional
injected parameter, and the tests pass a plain function. **Do not import `vi`.**

**Test file conventions** (from `lib/bubblebox/translate.test.ts` and
`lib/driver-auth/verify.test.ts`):

- Explicit imports: `import { describe, expect, it } from "vitest"` — globals
  are not enabled.
- Co-located as `lib/bubblebox/client.test.ts`.
- One top-level `describe` named after the exported symbol.
- Fixture factories that take a `Partial<T>` override object with a default of
  `{}`, as at `lib/bubblebox/translate.test.ts:10-19`.
- Async error assertions use `await expect(...).rejects.toBeInstanceOf(...)` or
  `.rejects.toThrow(/regex/)`. `toThrow` on a *sync* call is not used anywhere
  in this repo; for async rejections `.rejects` is the established form (see
  `lib/driver-auth/verify.test.ts:52`).
- Test titles are lowercase, verb-first, behaviour-oriented, and may carry a
  parenthetical rationale — e.g. `"rejects tokens with a non-RS256 algorithm
  (no HS256 downgrade)"` at `lib/driver-auth/verify.test.ts:88`.

**Documented design constraint you must honour.** From the design spec at
`docs/specs/2026-07-13-driver-auth-federation-design.md:461-465`:

> **The endpoint is `/fleet/verify-token`, authenticated exactly like
> `/fleet/rider-routes`**: the token from `/fleet/authentication-token` in the
> header. No new credentials. `workers/bubblebox-sync.ts` already mints that
> token, so the mint belongs in a shared module when driver-session starts
> calling it (do it then, not before — it has no second consumer yet).

and from `:467-469`:

> **Still open:** the request and response shape (where the rider token sits in
> the request, what the success body contains). Asked; not building against a
> guess until it lands.

This plan is the "shared module" half. The second sentence is why implementing
the endpoint is out of scope.

### Deployment note (no action needed, but do not be surprised)

`Dockerfile:32-43` bundles the workers with esbuild from **both** `workers/`
and `lib/`:

```dockerfile
COPY workers ./workers
COPY lib ./lib
RUN ./node_modules/.bin/esbuild \
      workers/bubblebox-sync.ts workers/driver-session.ts \
      --bundle --platform=node --target=node22 --format=esm \
```

so a new file under `lib/` is picked up automatically. **Do not edit the
Dockerfile or any compose file in this plan.**

## Commands you will need

| Purpose   | Command                                    | Expected on success        |
|-----------|--------------------------------------------|----------------------------|
| Install   | `pnpm install`                             | exit 0                     |
| Typecheck | `pnpm exec tsc --noEmit`                   | exit 0, no output          |
| Tests     | `pnpm test`                                | all pass (120 before this plan) |
| One suite | `pnpm exec vitest run lib/bubblebox`       | all pass                   |
| Lint      | `pnpm lint`                                | see note below             |
| Build     | `pnpm build`                               | exit 0, route table printed |

**Lint note**: `pnpm lint` is *already* red on this repo for unrelated
pre-existing reasons (a `react-hooks/refs` posture documented in
`plans/README.md`). Do not try to fix that. Only confirm you have not added new
errors in the files you touched.

**Shell note**: this repo is developed on Windows. The inline environment-variable
prefix used later in this plan (`BB_FIXTURE_FILE=… pnpm bb-sync`) is POSIX
syntax — run it in Git Bash. In PowerShell the equivalent is
`$env:BB_FIXTURE_FILE = "workers/dev-fixture.json"; pnpm bb-sync`.

## Scope

**In scope** (the only files you should modify or create):

- `lib/bubblebox/client.ts` (create)
- `lib/bubblebox/client.test.ts` (create)
- `workers/bubblebox-sync.ts` (modify — remove the moved code, call the client)

**Out of scope** (do NOT touch, even though they look related):

- **`/fleet/verify-token` — do not implement it, do not add a method for it,
  do not add a placeholder.** Its request and response shape is genuinely
  unknown, and the spec forbids building against a guess. A later plan adds it
  once BB documents it.
- `workers/driver-session.ts` — it will consume this client later, in a
  separate plan. Do not wire it up here.
- `lib/bubblebox/translate.ts` and its test — the translation layer is
  finished and correct. You may **import types** from it; do not edit it.
- `.env.example`, `docker-compose.prod.yml`, `Dockerfile`, `caddy/Caddyfile` —
  this plan introduces no new environment variables and no new services.
- The fixture path (`BB_FIXTURE_FILE`). It reads a local JSON file and never
  touches the network; it must keep working exactly as today and it stays in
  the worker, not in the client. The client is for HTTP only.
- Retry/backoff policy beyond the existing single 401 re-mint. Do not add
  general retries, timeouts, or circuit breakers — that is a separate decision.

## Git workflow

- Branch: `advisor/022-bubblebox-api-client`
- Commit style is Conventional Commits with a scope, lowercase subject, no
  trailing period. Recent real examples from `git log`:
  `feat(sync): wire the shipped Bubble Box fleet API`,
  `perf(docker): bundle the workers, 1.74GB -> 327MB each`.
  Use something like `refactor(bb): extract the Bubble Box API client into lib/`.
- **Do not add a `Co-Authored-By` trailer or any AI-authorship trailer.** This
  repo's history is deliberately free of them.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `lib/bubblebox/client.ts`

Create the module with this exact public surface. Inline comments should
explain *why* only where a reader would otherwise get it wrong (this repo keeps
rationale out of the code and in chat/docs — do not over-comment).

```ts
import type { BBRoute } from "@/lib/bubblebox/translate"

export type BubbleboxConfig = {
  baseUrl: string
  username: string
  password: string
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export type BubbleboxClient = {
  /** Authenticated request against a BB fleet path, e.g. "/api/v2/fleet/…".
   *  Mints a token on first use, caches it, and re-mints once on a 401. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>
  /** All rider routes for one Zurich-local date (YYYY-MM-DD). */
  fetchRiderRoutes(date: string): Promise<BBRoute[]>
}

export function createBubbleboxClient(config: BubbleboxConfig): BubbleboxClient
```

Implementation requirements — these are behavioural, and the tests in step 3
check each one:

1. Token state lives in a closure variable inside `createBubbleboxClient`, not
   at module scope. Two clients must not share a token.
2. `authedFetch` mints lazily (only when there is no cached token), sends the
   token in the **`accessToken`** header (exact casing), and merges any headers
   passed in `init` without dropping `accessToken`.
3. On a `401` response, `authedFetch` mints a **new** token and retries the
   request **exactly once**. It returns whatever the retry produced — including
   a second 401. It must not recurse or loop.
4. The mint POSTs JSON `{ username, password }` to
   `${baseUrl}/api/v2/fleet/authentication-token`, throws
   `` `BB token denied (${status})` `` when the response is not ok, and throws
   `"BB token response missing data.loginToken"` when `data.loginToken` is
   absent. Keep these messages **byte-identical** to the current ones — they
   are what shows up in the sync heartbeat and in `docker logs`.
5. `fetchRiderRoutes(date)` builds
   `` `/api/v2/fleet/rider-routes?dueDate[notEarlier]=${date}&dueDate[notLater]=${date}` ``,
   calls `authedFetch`, throws `` `BB routes fetch failed (${status})` `` when
   not ok, and returns the parsed JSON typed as `BBRoute[]`. Preserve the
   existing comment explaining why both date bounds are sent explicitly.
6. Never log, never read `process.env`, never touch the filesystem.

**Verify**: `pnpm exec tsc --noEmit` → exit 0, no output.

### Step 2: Rewire `workers/bubblebox-sync.ts` to use the client

- Delete `let bbToken`, `mintBBToken`, and the network half of `fetchStructure`
  (`workers/bubblebox-sync.ts:166-201`), along with the now-unused
  `// --- Bubble Box side ---` section banner if nothing is left under it.
- Import and construct the client once at module scope, **only when not in
  fixture mode**. The env constants at lines 31–33 stay in the worker; the
  worker owns configuration, the client receives it:

```ts
const bb =
  BB_API_URL && BB_USERNAME && BB_PASSWORD
    ? createBubbleboxClient({
        baseUrl: BB_API_URL,
        username: BB_USERNAME,
        password: BB_PASSWORD,
      })
    : null
```

- Keep `fetchStructure(date)` as the worker's own function, now thin:

```ts
async function fetchStructure(date: string): Promise<BBRoute[]> {
  if (FIXTURE) {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as BBRoute[]
  }
  return bb!.fetchRiderRoutes(date)
}
```

  If you dislike the `!`, guard with an explicit `if (!bb) throw new Error(...)`
  instead — the existing startup check at lines 37–42 already guarantees one of
  the two modes is configured, so either is correct. Do not change that startup
  check.
- Leave everything else in the worker alone: `zurichToday`, `log`,
  `withToken`, `fetchRiderMap`, `putVehicleRoutes`, `writeHeartbeat`, `tick`,
  `main`.

**Verify**:
- `pnpm exec tsc --noEmit` → exit 0
- `grep -n "mintBBToken\|bbToken" workers/bubblebox-sync.ts` → no matches
- `grep -c "fetch(" workers/bubblebox-sync.ts` → the count drops by 3 (the two
  BB calls in `fetchStructure` and the one in `mintBBToken` are gone; the
  Supabase/PostgREST calls remain)

### Step 3: Write `lib/bubblebox/client.test.ts`

Model the file structurally on `lib/bubblebox/translate.test.ts`. Build a fake
fetch as a **plain function** — no `vi`, no library. Sketch of the helper:

```ts
type Call = { url: string; init?: RequestInit }

function fakeFetch(responses: Response[]) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (!next) throw new Error("fakeFetch: no queued response")
    return next
  }) as unknown as typeof fetch
  return { fn, calls }
}

const tokenOk = () =>
  new Response(JSON.stringify({ data: { loginToken: "t1" } }), { status: 200 })
```

`Response` is a Node 22 global and the vitest environment is `node`
(`vitest.config.ts:6`), so no polyfill is needed.

Cover exactly these cases, one `it` each, inside
`describe("createBubbleboxClient", …)`:

1. mints on first call and sends the token in the `accessToken` header
2. caches the token — a second `authedFetch` does **not** mint again (assert the
   number of recorded calls, and that no second call hit the
   `authentication-token` path)
3. re-mints once and retries on a `401`, and the retry carries the **new** token
4. a second consecutive `401` is returned to the caller, not retried again
   (assert the total call count — this is the anti-loop guarantee)
5. a failed mint throws `/BB token denied \(500\)/`
6. a mint response without `data.loginToken` throws
   `/missing data.loginToken/`
7. `fetchRiderRoutes` requests both `dueDate[notEarlier]` and
   `dueDate[notLater]` with the given date, and returns the parsed array
8. a non-ok routes response throws `/BB routes fetch failed \(503\)/`
9. two clients built from the same config do not share a token (each mints its
   own) — this is the regression test for the module-scope state that was just
   removed

**Verify**: `pnpm exec vitest run lib/bubblebox` → all pass, 9 new tests
reported in `client.test.ts`.

### Step 4: Full verification

**Verify**, all four:
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm test` → all pass, and `client.test.ts` reports 9 passing tests. The
  repo-wide total was 120 before this plan, so expect **at least** 129 — it
  will be higher if plan 023 or 024 landed first. Do not treat a higher total
  as a failure.
- `pnpm build` → exit 0
- `BB_FIXTURE_FILE=workers/dev-fixture.json pnpm bb-sync` → the worker starts
  and logs a `"startup"` line with `"mode":"fixture"`. Stop it with Ctrl-C
  after the first `"tick"` line, or after ~10s if the local Next server and
  Supabase are not running (in that case a `tick_failed` line about the
  dispatcher session is expected and fine — it proves the fixture path still
  loads and the module graph is intact, which is all this step checks).

## Test plan

- **New file**: `lib/bubblebox/client.test.ts`, the 9 cases listed in step 3.
- **Structural pattern**: `lib/bubblebox/translate.test.ts` (fixture factories,
  single top-level `describe`, explicit vitest imports).
- **Injection pattern**: `lib/settings/storage.test.ts:5-12` (plain function
  passed in, no mocking library).
- **Existing tests must not change.** `lib/bubblebox/translate.test.ts` covers
  the translation layer and is untouched by this refactor. If any existing test
  fails, that is a STOP condition — this plan is behaviour-preserving.
- **Not covered by tests, by design**: the live network path against BB's real
  API. It needs credentials the executor does not have. It is verified by the
  operator afterwards; see "Maintenance notes".

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0, with 9 passing tests in `lib/bubblebox/client.test.ts`
      and no previously-passing test now failing
- [ ] `pnpm build` exits 0
- [ ] `lib/bubblebox/client.ts` and `lib/bubblebox/client.test.ts` exist
- [ ] `grep -n "mintBBToken\|let bbToken" workers/bubblebox-sync.ts` → no matches
- [ ] `grep -rn "authentication-token" workers/` → no matches (the mint now
      lives only in `lib/bubblebox/client.ts`)
- [ ] `grep -rn "verify-token" lib/ workers/` → no matches (this plan must not
      have implemented it)
- [ ] `grep -rn "vi\.\(mock\|fn\|spyOn\)" lib/bubblebox/` → no matches
- [ ] `git status --short` shows only the three in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" do not match the live code — especially if
  `workers/bubblebox-sync.ts` has already been changed to import from
  `lib/bubblebox/client`, which would mean this plan already ran.
- You cannot preserve the exact error message strings while restructuring.
  These strings are surfaced publicly through the health endpoint and changing
  them silently is worse than stopping.
- A test requires importing `vi` or adding a mocking library to pass. The
  design is wrong if that happens — report it rather than introducing the
  repo's first mock.
- You find yourself needing to know what `/fleet/verify-token` accepts or
  returns. That information does not exist yet. It is out of scope; stop.
- `pnpm test` shows any *pre-existing* test failing after your change.

## Maintenance notes

- **What this unblocks**: when Bubble Box documents `/fleet/verify-token`, the
  work is (a) add one method to `lib/bubblebox/client.ts` plus its tests, and
  (b) have `workers/driver-session.ts` construct a client and call it. The
  authentication half is then already proven.
- **What a reviewer should scrutinise**: that the 401 path re-mints exactly
  once (an accidental recursive retry against a permanently-401ing upstream
  would hammer BB every 60s), that the header is literally `accessToken`, and
  that the token cache did not accidentally return to module scope.
- **Still needs a human**: one live tick against BB's staging API with real
  credentials, confirming a real token mint and a real `rider-routes` fetch.
  The unit tests prove the logic; only a live run proves the contract.
  `docs/HANDOFF.md` records how the previous live verification was done.
- **Deliberately deferred**: request timeouts and general retry/backoff on BB
  calls. The worker's loop already tolerates a failed tick (it logs, writes the
  error to the heartbeat, and retries in 60s), so adding timeouts here would be
  a second, uncoordinated policy. Decide it once, for both consumers, after the
  login path is live.
