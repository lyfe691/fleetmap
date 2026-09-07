# Plan 024: Make the health endpoint cover the driver-login service

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat a0e0283..HEAD -- app/api/health/route.ts workers/driver-session.ts docker-compose.prod.yml .env.example docs/deployment.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `a0e0283`, 2026-07-28

## Why this matters

Production runs five containers. Four of them are observable: the app answers
`GET /api/health`, which probes Supabase and the routing engine and reports the
route-sync worker's heartbeat. The fifth — `driver-session`, the service every
delivery driver's app calls to log in — is observable by nothing at all.

There is no container healthcheck anywhere in the stack (`docker-compose.prod.yml`
defines none), no CI, and no configured uptime monitor; the documented alerting
strategy is "point an external monitor at `/api/health`". So if `driver-session`
dies or wedges, the single monitored endpoint keeps reporting `{"ok":true}` and
the first signal is drivers reporting they cannot log in.

This is not hypothetical. From `docs/HANDOFF.md:277-282`:

> **Why nobody noticed:** the deployed `sync` container is documented as
> "exits on boot until `BB_*` is set", so a crash-looping container looked
> exactly like expected behavior. It would have surfaced at go-live, the moment
> Dmytro's prod credentials went into `.env`, and it would have looked like his
> API was the problem.

Both worker containers had never once started in production, and nothing
surfaced it. That was caught by hand while smoke-testing an image.

The exposure is about to grow: the login service's verification step is moving
from a local computation to a call to a third-party API, which adds a
network dependency to the login path precisely where nothing is watching.

This plan adds a liveness route to the login service and folds it into the
existing health endpoint, so the one URL an uptime monitor watches actually
covers the whole stack.

## Current state

### The health endpoint

`app/api/health/route.ts:60-92` — the whole handler:

```ts
export async function GET() {
  // Auth (GoTrue) and PostgREST are separate services — probing auth alone
  // would report green through a database-path outage, which is what every
  // real feature (ingest, dashboard reads, sync) actually depends on.
  const [authOk, rest, osrmOk] = await Promise.all([
    SUPABASE_URL && SUPABASE_KEY
      ? probe(`${SUPABASE_URL}/auth/v1/health`, { apikey: SUPABASE_KEY })
      : Promise.resolve(false),
    readSyncState(),
    probe(`${OSRM_URL}/nearest/v1/driving/8.54,47.38`),
  ])
  const supabaseOk = authOk && rest.ok
  const sync = rest.state

  // Sync is informational, not gating: a missing row means the worker has
  // never run (expected until the Bubble Box endpoints are wired).
  const ok = supabaseOk && osrmOk
  return NextResponse.json(
    {
      ok,
      supabase: supabaseOk ? "ok" : "down",
      osrm: osrmOk ? "ok" : "down",
      sync: sync?.last_success_at
        ? { … }
        : null,
    },
    { status: ok ? 200 : 503 }
  )
}
```

with the existing probe helper at `app/api/health/route.ts:14-25`, which
swallows errors and returns a boolean, and a 3s timeout constant at `:10`.

### The login service accepts no probe today

`workers/driver-session.ts:184-192`:

```ts
const server = createServer((req, res) => {
  const respond = (status: number, body: Record<string, unknown>) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }

  if (req.method !== "POST") {
    return respond(405, { error: "POST only" })
  }
```

Every non-POST gets 405 regardless of path, so there is nothing a monitor or a
sibling container can call to ask "are you alive?".

### Networking facts you need

`docker-compose.prod.yml` gives `caddy` two networks (`:24-26`) and leaves
`app`, `sync`, `driver-session` and `osrm` on the implicit `default` network.
Compose service names resolve as hostnames there, which is already relied on:
`app` reaches OSRM via `OSRM_URL: http://osrm:5000` (`docker-compose.prod.yml:38`)
and `sync` reaches the app via `FLEETMAP_API_URL: http://app:3000` (`:51`).
So `app` can reach `http://driver-session:3100` with no new networking.

`driver-session` exposes port 3100 internally (`docker-compose.prod.yml:66-67`)
and is reachable publicly only through the single Caddy route
`handle /api/driver-session` (`caddy/Caddyfile:9-11`).

### The documentation that will be wrong after this change

`docs/deployment.md:389-398`:

```
- **Health:** one endpoint covers app + Supabase + OSRM + sync freshness:

  ```bash
  curl -s https://fleet.ysz.life/api/health
  # {"ok":true,"supabase":"ok","osrm":"ok","sync":null}
  # sync is null until the Bubble Box worker has run; 503 when supabase/osrm is down
  ```

  Point an external uptime monitor (e.g. UptimeRobot, free tier) at this
  URL — it's the only alerting the stack has.
```

### Repo conventions you must match

**Style**: no semicolons, double quotes, 2-space indent.

**Route handlers** return `NextResponse.json` with explicit status codes; this
one uses 200/503. Keep that.

**Tests**: the repo has **no tests for route handlers or workers** — the vitest
environment is `node` with no HTTP harness. The established response to that is
to extract the pure decision into `lib/` and unit-test it there; the precedent
is `lib/ingest-validate.ts`, carved out of a route handler for exactly this
reason. This plan follows that precedent for the one piece of real logic it
adds (how the parts combine into `ok`). Do **not** attempt to test the handler
itself, and do **not** add a mocking library — this repo has zero `vi.mock` /
`vi.fn` usage.

## Commands you will need

| Purpose   | Command                                | Expected on success             |
|-----------|----------------------------------------|---------------------------------|
| Install   | `pnpm install`                         | exit 0                          |
| Typecheck | `pnpm exec tsc --noEmit`               | exit 0, no output               |
| Tests     | `pnpm test`                            | all pass (120 before this plan) |
| One suite | `pnpm exec vitest run lib/health`      | all pass                        |
| Build     | `pnpm build`                           | exit 0                          |
| Dev server| `pnpm dev`                             | serves on :3000                 |
| Worker    | `pnpm driver-session`                  | logs a `startup` JSON line      |

**Shell note**: this repo is developed on Windows. The inline
environment-variable prefixes in this plan (`DRIVER_SESSION_PORT=3199 pnpm
driver-session`, `DRIVER_SESSION_URL=http://localhost:3199 pnpm dev`) are POSIX
syntax — run them in Git Bash. In PowerShell the equivalent is
`$env:DRIVER_SESSION_PORT = "3199"; pnpm driver-session`.

## Scope

**In scope**:

- `lib/health.ts` (create — the pure summary function)
- `lib/health.test.ts` (create)
- `app/api/health/route.ts` (modify — probe the login service, use the helper)
- `workers/driver-session.ts` (modify — answer a liveness GET)
- `docker-compose.prod.yml` (modify — **only** the `app` service's
  `environment:` block, to add `DRIVER_SESSION_URL`)
- `.env.example` (modify — document the new variable)
- `docs/deployment.md` (modify — **only** the Health bullet at `:389-398`)

**Out of scope** (do NOT touch):

- The `POST` path of `workers/driver-session.ts` — the exchange logic, the
  body-size cap, the 400/401/403/413 responses. Only the method dispatch at
  line 190 changes.
- `docs/driver-session-api.md` — that document describes the client contract
  for the driver app. A liveness route is an operational detail; adding it
  there invites the app author to depend on it.
- Any other part of `docker-compose.prod.yml`, including its header comments.
  Those are stale and get fixed in plan 025 — leave them alone here so the two
  diffs stay reviewable.
- Adding a compose `healthcheck:` stanza, an uptime monitor, or alerting.
  Out of scope by design: this plan makes the state *observable*; choosing and
  configuring a watcher is an operator decision, not a code change.
- `supabase-docker/` — a separate vendored stack.
- Writing a `sync_state` heartbeat row for the login service. Considered and
  rejected: `sync_state` writes require a dispatcher-role JWT
  (`supabase/migrations/0013_sync_state.sql`), and the login service
  deliberately holds a different, more privileged credential that must not
  spread. An HTTP probe needs no new credential anywhere.

## Git workflow

- Branch: `advisor/024-health-covers-driver-session`
- Conventional Commits, lowercase subject, no trailing period. Real examples:
  `fix(deploy): reload caddy after every redeploy`,
  `feat(sync): wire the shipped Bubble Box fleet API`. Suggested:
  `feat(health): cover the driver-session service`.
- **Do not add a `Co-Authored-By` trailer or any AI-authorship trailer.**
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Answer a liveness GET in the login service

In `workers/driver-session.ts`, before the `req.method !== "POST"` check at
line 190, add a GET branch that responds `200 { ok: true }`. Respond to any
GET regardless of path — the service is reached through exactly one Caddy
route, so path-matching adds nothing.

Keep the 405 for every other method.

**Verify**:
1. `pnpm exec tsc --noEmit` → exit 0
2. In one terminal `DRIVER_SESSION_PORT=3199 pnpm driver-session`, then in
   another:
   - `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3199/` → `200`
   - `curl -s http://localhost:3199/` → `{"ok":true}`
   - `curl -s -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3199/`
     → `405`
   - `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3199/ -H 'Content-Type: application/json' -d '{"token":"not-a-jwt"}'`
     → `401` (proves the POST path is untouched)

   If the worker refuses to start with a `Missing env` error, set the three
   variables it names in your `.env` first — `pnpm driver-test-token` prints a
   usable value for the third one.

### Step 2: Create `lib/health.ts` with the pure summary

The only real logic this plan adds is how the parts combine, including the
"unconfigured means not gating" rule. Extract it so it can be tested:

```ts
export type ServiceState = "ok" | "down" | null

export type HealthParts = {
  supabaseOk: boolean
  osrmOk: boolean
  /** null when DRIVER_SESSION_URL is not configured (dev, or not yet rolled out). */
  driverSessionOk: boolean | null
}

/** ok gates on every configured service. An unconfigured one is reported as
 *  null and never fails the check. */
export function summarizeHealth(parts: HealthParts): {
  ok: boolean
  supabase: ServiceState
  osrm: ServiceState
  driver_session: ServiceState
}
```

`ok` is `supabaseOk && osrmOk && driverSessionOk !== false`.

**Verify**: `pnpm exec tsc --noEmit` → exit 0

### Step 3: Probe the login service from the health handler

In `app/api/health/route.ts`:

- Add `const DRIVER_SESSION_URL = process.env.DRIVER_SESSION_URL` alongside the
  other module constants at lines 6–8.
- Add a fourth entry to the existing `Promise.all` that calls the existing
  `probe()` helper against `DRIVER_SESSION_URL` when it is set, and resolves to
  `null` when it is not. `probe()` already applies the 3s timeout and swallows
  errors, so reuse it rather than writing a second fetch.
- Replace the hand-rolled `ok` / `supabase` / `osrm` fields with
  `summarizeHealth(...)`, spreading its result into the JSON body. **Keep the
  `sync` field exactly as it is** — it stays informational and non-gating, and
  its shape is consumed by existing runbooks.

The response body becomes:

```json
{"ok":true,"supabase":"ok","osrm":"ok","driver_session":"ok","sync":null}
```

**Verify**:
- `pnpm exec tsc --noEmit` → exit 0
- `pnpm build` → exit 0
- With `pnpm dev` running and no `DRIVER_SESSION_URL` set:
  `curl -s http://localhost:3000/api/health` → the body contains
  `"driver_session":null` and `ok` is unchanged from before this plan.
- With the worker running on 3199 and
  `DRIVER_SESSION_URL=http://localhost:3199 pnpm dev`:
  `curl -s http://localhost:3000/api/health` → `"driver_session":"ok"`.
- Stop the worker, re-run the same curl → `"driver_session":"down"` and the
  HTTP status is `503`.

### Step 4: Wire the variable in production and document it

- `docker-compose.prod.yml`, `app` service `environment:` block (currently
  `:37-38`, holding only `OSRM_URL`) — add:
  `DRIVER_SESSION_URL: http://driver-session:3100`. Change nothing else in the
  file.
- `.env.example` — document `DRIVER_SESSION_URL` near the existing `OSRM_URL`
  entry, matching the surrounding comment style: server-only, set by compose in
  production, and safe to leave unset in dev (health then reports
  `driver_session: null`).
- `docs/deployment.md:389-398` — update the Health bullet: the endpoint now
  covers app + Supabase + OSRM + driver-session + sync freshness, and the
  sample response gains `"driver_session":"ok"`. Keep the uptime-monitor
  sentence.

**Verify**:
- `docker compose -f docker-compose.prod.yml config --quiet` → exit 0 (valid
  compose after the edit; requires a local `.env`, and if you do not have one,
  skip this and rely on the next check)
- `git diff docker-compose.prod.yml` → exactly one added line, inside the `app`
  service's `environment:` block
- `grep -n "driver_session" docs/deployment.md` → at least one match

### Step 5: Write `lib/health.test.ts`

Model on `lib/settings/storage.test.ts` (small, pure, plain values). Inside
`describe("summarizeHealth", …)`:

1. all healthy and driver-session configured → `ok: true`, all three fields
   `"ok"`
2. driver-session unconfigured (`null`) → `ok: true` and
   `driver_session: null` (this is the dev/rollout case and must not fail)
3. driver-session configured but down → `ok: false` and
   `driver_session: "down"`
4. supabase down → `ok: false` regardless of the others
5. osrm down → `ok: false` regardless of the others

**Verify**: `pnpm exec vitest run lib/health` → 5 tests pass.

## Test plan

- **New file**: `lib/health.test.ts`, the 5 cases above.
- **Structural pattern**: `lib/settings/storage.test.ts` — plain inputs, plain
  assertions, no mocking.
- **Deliberately untested**: the handler's fetch calls and the worker's HTTP
  dispatch. There is no route-handler test harness in this repo and adding one
  is far outside this plan. Those paths are covered by the manual curl checks
  in steps 1 and 3, which are exact and reproducible.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm test` exits 0, with 5 passing tests in `lib/health.test.ts` and no
      previously-passing test now failing (the repo-wide total was 120 before
      this plan, so expect at least 125 — higher if 022 or 023 landed first)
- [ ] `pnpm build` exits 0
- [ ] `lib/health.ts` and `lib/health.test.ts` exist
- [ ] `grep -n "DRIVER_SESSION_URL" app/api/health/route.ts docker-compose.prod.yml .env.example`
      → a match in each of the three files
- [ ] `grep -n "driver_session" docs/deployment.md` → at least one match
- [ ] Worker returns 200 on GET and still 401 on a POST with a junk token
      (step 1 checks)
- [ ] `git status --short` shows only the seven in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `workers/driver-session.ts` no longer matches the excerpt at lines 184–192 —
  particularly if it already handles GET, which would mean this plan already
  ran.
- Adding the GET branch would require touching the POST handling. It does not.
- You are tempted to make `ok` false when `driver_session` is `null`. That
  would turn every dev machine and any not-yet-configured deployment red.
  If the requirement seems to demand it, stop and ask.
- `docker compose -f docker-compose.prod.yml config` reports an error after
  your edit.
- Any pre-existing test fails.

## Maintenance notes

- **Operator follow-up this plan does not do**: `DRIVER_SESSION_URL` must be
  present in the app container for the probe to report anything but `null`.
  It is set through `docker-compose.prod.yml`, so it arrives with the next
  `./redeploy.sh` — a compose-only change needs no image rebuild (see
  `docs/deployment.md:52-65`). Until that redeploy runs, production will report
  `"driver_session":null`, which is correct and non-gating.
- **What a reviewer should scrutinise**: that `ok` still cannot be made false
  by the `sync` field (it remains informational), and that the new probe uses
  the existing `probe()` helper so it inherits the 3s timeout — a hanging
  login service must not hang the health endpoint.
- **Interacts with future work**: when the login service starts calling a
  third-party verification API, "alive" and "able to log drivers in" stop being
  the same thing. At that point consider extending the liveness route to report
  upstream reachability too, rather than adding a second endpoint.
- **Deliberately deferred**: compose `healthcheck:` stanzas for automatic
  container restarts, and actually configuring an external monitor. Both are
  operator decisions; this plan only makes the truth visible.
