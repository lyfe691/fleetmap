# Driver Session Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish, harden, document, and package a production-ready FleetMap
Bubble Box `fleetAuthToken` to Supabase driver-session release artifact, with
the remaining human-gated deployment and real-token proof stated explicitly.

**Architecture:** Keep the public rider-app contract at `{ token }`, delegate
rider verification to Bubble Box through the existing shared client, and keep
the downstream `rider_ref` to Supabase-session exchange unchanged. Extract the
worker's HTTP transport into a focused module, apply finite upstream request
deadlines, make login liveness part of `/api/health`, and generate a locally
built three-image release archive for the VPS.

**Tech Stack:** TypeScript, Node.js HTTP/fetch, Vitest, Next.js App Router,
Supabase Auth/PostgREST, Docker BuildKit, Docker Compose, Caddy.

## Global Constraints

- The public `POST /api/driver-session` request remains
  `{ "token": "<fleetAuthToken>" }`.
- Bubble Box receives the same value as `{ riderAuthToken }` over the private
  server-to-server call.
- Never log or write a rider token, fleet token, Supabase access token, or
  Supabase refresh token.
- Preserve the `403` from Bubble Box to FleetMap `401` mapping; every other
  upstream failure remains an infrastructure `500`.
- The driver-session body limit is 16,384 bytes, not characters.
- Production images are built locally for `linux/amd64`; the VPS never builds.
- No database migration, replay store, rate limiter, provisioning redesign, or
  RLS change is part of this plan.
- Preserve the user's untracked `NEXT-STEPS.md` until the current runbook
  information has been incorporated into living documentation.
- "Complete" for this plan means source and release artifact ready. It does not
  mean the new verifier is live: this machine has no VPS SSH access, and the
  supplied rider test fixture currently cannot mint a token.

---

## File map

- `lib/bubblebox/client.ts`: fleet token mint/cache/retry and finite request
  deadline.
- `lib/bubblebox/client.test.ts`: deadline regression test.
- `lib/driver-auth/http.ts`: public driver-session HTTP boundary.
- `lib/driver-auth/http.test.ts`: real Node HTTP tests around that boundary.
- `workers/driver-session.ts`: dependency wiring and server startup only.
- `lib/driver-auth/diagnostic.ts`: redacted diagnostic formatting.
- `lib/driver-auth/diagnostic.test.ts`: proves secrets cannot appear in output.
- `scripts/verify-live-token.ts`: stdin-only token ingestion and correct exit
  behavior.
- `lib/health.ts` / `lib/health.test.ts`: pure health aggregation.
- `app/api/health/route.ts`: probes driver-session and uses the aggregation.
- `docker-compose.prod.yml`: truthful header, explicit image names, internal
  health URL.
- `.dockerignore`: excludes retired key material and release archives.
- `.env.example`: documents driver-session health configuration.
- `docs/driver-session-api.md`: Roman's complete client contract and token
  lifecycle.
- `docs/deployment.md`: current build, environment, deploy, and smoke-test
  runbook.
- `CLAUDE.md`, `README.md`, `docs/HANDOFF.md`,
  `docs/specs/2026-07-13-driver-auth-federation-design.md`,
  `plans/README.md`: remove contradictory current-state claims while retaining
  historical context.

---

### Task 1: Bound Bubble Box request duration

**Files:**

- Modify: `lib/bubblebox/client.ts`
- Modify: `lib/bubblebox/client.test.ts`

**Interfaces:**

- Consumes: existing `BubbleboxConfig` and `BubbleboxClient`.
- Produces: optional `timeoutMs?: number` on `BubbleboxConfig`, default
  `10_000`; every network attempt receives a deadline signal.

- [ ] **Step 1: Write the stalled-request regression test**

Add this case to `lib/bubblebox/client.test.ts`:

```ts
it("aborts a stalled token mint after the configured deadline", async () => {
  const hangingFetch: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      expect(signal).toBeInstanceOf(AbortSignal)
      signal?.addEventListener(
        "abort",
        () => reject(signal.reason ?? new Error("aborted")),
        { once: true }
      )
    })

  const client = createBubbleboxClient({
    baseUrl: "https://bb.test",
    username: "u",
    password: "p",
    fetchImpl: hangingFetch,
    timeoutMs: 10,
  })

  await expect(client.fetchRiderRoutes("2026-07-31")).rejects.toBeDefined()
}, 250)
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
pnpm exec vitest run lib/bubblebox/client.test.ts
```

Expected: failure because `timeoutMs` is not part of `BubbleboxConfig` and the
hanging fetch never receives an aborting signal.

- [ ] **Step 3: Add one deadline per fetch attempt**

Extend `BubbleboxConfig` and route both mint and authenticated calls through:

```ts
const timeoutMs = config.timeoutMs ?? 10_000

function withDeadline(init: RequestInit = {}): RequestInit {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal,
  }
}
```

Call `fetchImpl(url, withDeadline(init))` for the initial fleet-token mint, the
authenticated request, and the one retry after a `401`. Create a fresh
deadline for each attempt; do not reuse an already-aborted signal.

- [ ] **Step 4: Verify GREEN and existing client behavior**

Run:

```bash
pnpm exec vitest run lib/bubblebox/client.test.ts
pnpm typecheck
```

Expected: all client tests pass and typecheck exits zero.

- [ ] **Step 5: Commit**

```bash
git add lib/bubblebox/client.ts lib/bubblebox/client.test.ts
git commit -m "fix(bb): bound fleet api requests"
```

---

### Task 2: Extract and harden the driver-session HTTP boundary

**Files:**

- Create: `lib/driver-auth/http.ts`
- Create: `lib/driver-auth/http.test.ts`
- Modify: `workers/driver-session.ts`

**Interfaces:**

- Consumes:
  `exchangeToken(token: string): Promise<ExchangeResult>` and the existing
  structured logger signature.
- Produces:
  `createDriverSessionHandler(deps): RequestListener`.
- Preserves: `OPTIONS 204`, `GET 200`, `{ token }`, exchange status/body, and
  public error strings.

- [ ] **Step 1: Write real HTTP tests against the wished-for handler**

Create `lib/driver-auth/http.test.ts`. Start a Node server on port `0` for each
test and close it in `finally`. Cover these exact behaviors:

```ts
it("answers preflight with CORS", async () => {
  const response = await request({ method: "OPTIONS" })
  expect(response.status).toBe(204)
  expect(response.headers.get("access-control-allow-origin")).toBe("*")
  expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type")
})

it("returns liveness without invoking exchange", async () => {
  const response = await request({ method: "GET" })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
  expect(exchangeCalls).toEqual([])
})

it("passes a token to the exchange and never permits caching", async () => {
  const response = await request({
    method: "POST",
    body: JSON.stringify({ token: "fresh-token" }),
  })
  expect(exchangeCalls).toEqual(["fresh-token"])
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("pragma")).toBe("no-cache")
})

it("measures the 16 KiB limit in bytes", async () => {
  const response = await request({
    method: "POST",
    body: JSON.stringify({ token: "ü".repeat(8_192) }),
  })
  expect(response.status).toBe(413)
  expect(exchangeCalls).toEqual([])
})

it("answers 413 on the first overflowing chunk without waiting for end", async () => {
  const { request: streamingRequest, responsePromise } =
    openStreamingRequest()
  streamingRequest.write(Buffer.alloc(16_385))
  const response = await responsePromise
  expect(response.statusCode).toBe(413)
  streamingRequest.destroy()
})
```

Also test malformed JSON `400`, missing token `400`, unsupported method `405`,
exchange result passthrough, and thrown exchange dependency `500` with the
generic `{ error: "exchange failed" }` body.

- [ ] **Step 2: Run the new suite and confirm RED**

Run:

```bash
pnpm exec vitest run lib/driver-auth/http.test.ts
```

Expected: import/module-not-found failure because `http.ts` does not exist.

- [ ] **Step 3: Implement the bounded handler**

Create `lib/driver-auth/http.ts` with:

```ts
import type { IncomingMessage, RequestListener } from "node:http"
import type { ExchangeResult } from "./exchange"

const MAX_BODY_BYTES = 16_384

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  ...CORS_HEADERS,
}
```

The `data` listener must increment `byteLength` by `chunk.length`. Append a
chunk only while the total remains within `MAX_BODY_BYTES`. On the first chunk
that makes the total exceed the limit, respond `413` immediately, mark the
request finished, discard/drain later chunks, and make the `end` listener a
no-op. Convert the bounded `Buffer.concat(chunks, byteLength)` once only for a
non-overflowing request.

The dependency type is:

```ts
export type DriverSessionHttpDeps = {
  exchangeToken: (token: string) => Promise<ExchangeResult>
  log: (
    level: "info" | "warn" | "error",
    event: string,
    fields?: Record<string, unknown>
  ) => void
}
```

Never include the submitted token in a log field.

- [ ] **Step 4: Replace the worker's inline transport with the handler**

In `workers/driver-session.ts`:

- import `createDriverSessionHandler`;
- remove `MAX_BODY_BYTES`, `CORS_HEADERS`, and the inline `createServer`
  callback;
- create the server with:

```ts
const server = createServer(
  createDriverSessionHandler({
    exchangeToken: (token) => exchangeRiderToken(token, deps),
    log,
  })
)
```

Keep environment validation, Bubble Box/Supabase dependency wiring, startup
log, `listen`, and shutdown behavior unchanged.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm exec vitest run lib/driver-auth/http.test.ts
pnpm exec vitest run lib/driver-auth
pnpm typecheck
pnpm exec eslint lib/driver-auth/http.ts lib/driver-auth/http.test.ts workers/driver-session.ts
```

Expected: every command exits zero.

- [ ] **Step 6: Commit**

```bash
git add lib/driver-auth/http.ts lib/driver-auth/http.test.ts workers/driver-session.ts
git commit -m "fix(auth): harden the driver session boundary"
```

---

### Task 3: Make the real-token diagnostic safe

**Files:**

- Create: `lib/driver-auth/diagnostic.ts`
- Create: `lib/driver-auth/diagnostic.test.ts`
- Modify: `scripts/verify-live-token.ts`

**Interfaces:**

- Consumes: the rider token from stdin; optional driver-session URL remains the
  first argument.
- Produces: redacted status summaries and a nonzero exit code for every failed
  verification or exchange.

- [ ] **Step 1: Write the redaction tests**

Create `lib/driver-auth/diagnostic.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { summarizeExchangeBody } from "./diagnostic"

describe("summarizeExchangeBody", () => {
  it("reports session field presence without returning token values", () => {
    const summary = summarizeExchangeBody(
      200,
      JSON.stringify({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        expires_in: 3600,
      })
    )
    const rendered = JSON.stringify(summary)
    expect(summary).toEqual({
      status: 200,
      session: {
        access_token: "present",
        refresh_token: "present",
        expires_in: 3600,
      },
    })
    expect(rendered).not.toContain("access-secret")
    expect(rendered).not.toContain("refresh-secret")
  })

it("classifies a failure without trusting server text", () => {
  expect(
    summarizeExchangeBody(
      401,
      JSON.stringify({
        error: "invalid token: submitted-secret",
        token: "submitted-secret",
      })
    )
  ).toEqual({ status: 401, error: "invalid token" })
  expect(
    JSON.stringify(
      summarizeExchangeBody(
        401,
        JSON.stringify({ error: "submitted-secret" })
      )
    )
  ).not.toContain("submitted-secret")
})
})
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
pnpm exec vitest run lib/driver-auth/diagnostic.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the pure redactor**

Create `lib/driver-auth/diagnostic.ts` exporting:

```ts
export function summarizeExchangeBody(
  status: number,
  text: string
):
  | {
      status: number
      session: {
        access_token: "present" | "missing"
        refresh_token: "present" | "missing"
        expires_in: number | null
      }
    }
  | { status: number; error: string }
```

Parse defensively. A success reports only field presence and numeric
`expires_in`. A failure never returns response text; classify only by status:
`400` as `"malformed request"`, `401` as `"invalid token"`, `403` as
`"unmapped rider"`, `413` as `"body too large"`, `500` as
`"exchange failed"`, and every other status as `"unexpected response"`.

- [ ] **Step 4: Switch the script from argv to stdin**

In `scripts/verify-live-token.ts`:

- read the entire token from file descriptor `0` using
  `node:fs/promises.readFile`;
- trim it and reject an empty value;
- interpret `process.argv[2]` as the optional driver-session URL;
- change usage to:

```text
Get-Clipboard | pnpm verify-live-token [driverSessionUrl]
```

- stop printing `BB_API_USERNAME`;
- call `process.exit(1)` after direct Bubble Box verification fails;
- print `summarizeExchangeBody(res.status, body)` instead of `body.slice(...)`;
- call `process.exit(1)` for every non-2xx exchange response.

Do not add an environment-variable or argv token fallback.

Add a process-level check after implementation:

```powershell
'' | pnpm verify-live-token not-a-token
if ($LASTEXITCODE -eq 0) {
  throw 'the diagnostic still accepted argv without stdin'
}
```

This must exit before any network request and must not print `not-a-token`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm exec vitest run lib/driver-auth/diagnostic.test.ts
pnpm typecheck
pnpm exec eslint lib/driver-auth/diagnostic.ts lib/driver-auth/diagnostic.test.ts scripts/verify-live-token.ts
```

Expected: all commands exit zero.

- [ ] **Step 6: Commit**

```bash
git add lib/driver-auth/diagnostic.ts lib/driver-auth/diagnostic.test.ts scripts/verify-live-token.ts
git commit -m "fix(auth): redact the live token diagnostic"
```

---

### Task 4: Cover login health and make deployment inputs truthful

**Files:**

- Create: `lib/health.ts`
- Create: `lib/health.test.ts`
- Modify: `app/api/health/route.ts`
- Modify: `docker-compose.prod.yml`
- Modify: `.env.example`
- Modify: `.dockerignore`
- Modify: `plans/README.md`

**Interfaces:**

- Produces:
  `summarizeHealth({ supabaseOk, osrmOk, driverSessionOk })`.
- Production response gains
  `"driver_session": "ok" | "down" | null`.
- Compose uses explicit `fleetmap-app`, `fleetmap-sync`, and
  `fleetmap-driver-session` image names.

- [ ] **Step 1: Write health aggregation tests**

Create `lib/health.test.ts` with five cases:

```ts
expect(
  summarizeHealth({
    supabaseOk: true,
    osrmOk: true,
    driverSessionOk: true,
  })
).toEqual({
  ok: true,
  supabase: "ok",
  osrm: "ok",
  driver_session: "ok",
})
```

Also assert:

- `driverSessionOk: null` is non-gating and reports `null`;
- `driverSessionOk: false` gates `ok` and reports `"down"`;
- Supabase down gates `ok`;
- OSRM down gates `ok`.

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
pnpm exec vitest run lib/health.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement and wire health aggregation**

Create `lib/health.ts`:

```ts
export type ServiceState = "ok" | "down" | null

export function summarizeHealth(parts: {
  supabaseOk: boolean
  osrmOk: boolean
  driverSessionOk: boolean | null
}) {
  return {
    ok:
      parts.supabaseOk &&
      parts.osrmOk &&
      parts.driverSessionOk !== false,
    supabase: parts.supabaseOk ? "ok" : "down",
    osrm: parts.osrmOk ? "ok" : "down",
    driver_session:
      parts.driverSessionOk == null
        ? null
        : parts.driverSessionOk
          ? "ok"
          : "down",
  } satisfies {
    ok: boolean
    supabase: ServiceState
    osrm: ServiceState
    driver_session: ServiceState
  }
}
```

In `app/api/health/route.ts`, read `DRIVER_SESSION_URL`, add a fourth
`Promise.all` probe using the existing three-second helper, pass `null` when
unconfigured, spread `summarizeHealth(...)` into the response, and leave
`sync` informational.

- [ ] **Step 4: Correct Compose and Docker build context**

In `docker-compose.prod.yml`:

- replace the stale managed-Supabase/`--build` header with the actual
  self-hosted two-stack and locally shipped image workflow;
- add `image: fleetmap-app:latest`, `image: fleetmap-sync:latest`, and
  `image: fleetmap-driver-session:latest` beside the three existing build
  blocks;
- add `DRIVER_SESSION_URL: http://driver-session:3100` to the app environment.

In `.dockerignore`, add:

```text
.driver-auth-dev
*.pem
fleetmap-images*.tar
fleetmap-images*.tar.gz
```

In `.env.example`, document `DRIVER_SESSION_URL` beside `OSRM_URL`; it is
server-only, optional in local development, and injected by Compose in
production.

- [ ] **Step 5: Update plan status**

In `plans/README.md`, mark plan 024 and plan 025 done with the description
`2026-07-31 driver-session cutover; see git history`. Remove the obsolete
paragraph that says the verification swap is blocked by a `403`; replace it
with a reference to the 2026-07-31 cutover spec.

- [ ] **Step 6: Verify GREEN and configuration**

Run:

```powershell
pnpm exec vitest run lib/health.test.ts
pnpm typecheck
docker compose -f docker-compose.prod.yml config `
  --no-env-resolution --no-interpolate --quiet
rg -n "^\\.driver-auth-dev$|^\\*\\.pem$|^fleetmap-images" .dockerignore
```

Expected: health tests and typecheck pass; Compose renders; both sensitive
build-context patterns exist in `.dockerignore`.

- [ ] **Step 7: Commit**

```powershell
git add .dockerignore .env.example app/api/health/route.ts `
  docker-compose.prod.yml lib/health.ts lib/health.test.ts plans/README.md
git commit -m "feat(health): cover the driver session service"
```

---

### Task 5: Reconcile all living documentation

**Files:**

- Modify: `docs/driver-session-api.md`
- Modify: `docs/deployment.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/specs/2026-07-13-driver-auth-federation-design.md`
- Modify: `docs/specs/2026-07-31-driver-session-cutover-design.md`
- Delete after incorporation: `NEXT-STEPS.md`

**Interfaces:**

- Produces one consistent five-token lifecycle and one current deploy
  checklist.
- Historical investigation remains available but cannot masquerade as current
  state.

- [ ] **Step 1: Rewrite Roman's client handoff**

Update `docs/driver-session-api.md` to include:

- a five-token glossary;
- immediate exchange after login;
- on-demand reacquisition through
  `GET /api/v2/riders/fleet-auth-token` with the rider access token in
  `accessToken`;
- response path `data.fleetAuthToken`;
- persisted Supabase `setSession`;
- cold start uses Supabase refresh first;
- refresh failure reacquires a new `fleetAuthToken` without an interactive
  login while the rider access token is valid;
- unchanged public `{ token }` request and error table;
- explicit warning that Roman's supplied legacy login fixture returned 404/401
  during the 2026-07-31 test and needs correction before release proof.

- [ ] **Step 2: Correct deployment documentation**

In `docs/deployment.md`:

- remove every instruction to install, rotate, or wait for a Bubble Box
  signing/public key;
- describe the four keys in `.env.driver-session`;
- update health output with `driver_session`;
- keep all three local image build commands and add archive inspection;
- use explicit image tags matching Compose;
- state that the current integration has no migration;
- update the driver-session smoke test and safe stdin diagnostic invocation;
- state that a valid exchange can auto-provision/assign data and therefore
  needs a controlled rider mapping;
- rename the operations row from signing-key rotation to Bubble Box credential
  rotation.

- [ ] **Step 3: Correct project status documents**

- `CLAUDE.md`: replace the contradictory M20/Next entries with one 2026-07-31
  truth: code complete locally, CORS deployed, verification-swap artifact still
  to ship, real-token proof blocked by the supplied fixture.
- `README.md`: include driver-session in architecture/build/deploy status.
- `docs/HANDOFF.md`: add an authoritative 2026-07-31 current-state section at
  the top; mark the older 403 investigation as historical; delete the paragraph
  that says the known success body is unknown and the final stale blocked-state
  summary.
- old auth spec: add a prominent supersession pointer and correct its final
  addendum to the current endpoint, response, refresh path, and deployment
  state.

- [ ] **Step 4: Incorporate and remove the scratch handoff**

Confirm every still-valid manual action in `NEXT-STEPS.md` exists in
`docs/deployment.md`, `docs/driver-session-api.md`, or the new cutover spec.
Then resolve and verify the exact file first, and delete only that untracked
scratch file. It is recoverable from commit `3b1e1ed`:

```powershell
$scratch = (Resolve-Path -LiteralPath '.\NEXT-STEPS.md').Path
$expectedScratch = Join-Path (git rev-parse --show-toplevel) 'NEXT-STEPS.md'
if ($scratch -ne $expectedScratch) {
  throw "unexpected scratch path: $scratch"
}
Remove-Item -LiteralPath $scratch
```

- [ ] **Step 5: Self-review documentation**

Run:

```powershell
rg -n "BB_DRIVER_JWT_PUBLIC_KEY_B64|signing key|real public key|only the rider app can issue|response shape is still unknown|swap is blocked|fleet/verify-token" `
  CLAUDE.md README.md docs plans
rg -n "fleet-auth-token|fleetAuthToken|riderAuthToken|driver_session" `
  docs/driver-session-api.md docs/deployment.md CLAUDE.md
git diff --check
```

Expected: the first search returns only clearly labeled historical/rejected
design narrative; the second finds the living contract in all three current
documents; diff check is clean.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs plans/README.md
git commit -m "docs(auth): reconcile the rider session handoff"
```

---

### Task 6: Full verification and release archive

**Files:**

- Regenerate: `fleetmap-images.tar.gz` (gitignored release artifact)

**Interfaces:**

- Produces three `linux/amd64` images:
  `fleetmap-app:latest`, `fleetmap-sync:latest`, and
  `fleetmap-driver-session:latest`.
- Produces one gzip-compressed Docker archive and its reported SHA-256.

- [ ] **Step 1: Run source verification from a clean worktree**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
git status --short --branch
```

Expected:

- all tests pass;
- typecheck exits zero;
- lint has no errors (the repository's documented pre-existing warnings may
  remain);
- Next production build exits zero;
- only intended committed work plus the old gitignored release artifact is
  present.

- [ ] **Step 2: Validate the production public Supabase values**

Read the production Supabase publishable key from the current client handoff
without printing it, then request `/auth/v1/health`:

```powershell
$prodSupabaseUrl = 'https://sb.fleet.ysz.life'
$handoff = Get-Content -Raw 'docs\driver-session-api.md'
$keyMatch = [regex]::Match(
  $handoff,
  '\| Supabase publishable key \| `([^`]+)` \|'
)
if (-not $keyMatch.Success) {
  throw 'production publishable key is missing from the client handoff'
}
$prodPublishableKey = $keyMatch.Groups[1].Value
$healthStatus = curl.exe -sS -o NUL -w '%{http_code}' `
  -H "apikey: $prodPublishableKey" `
  "$prodSupabaseUrl/auth/v1/health"
if ($healthStatus -ne '200') {
  throw "production Supabase public-key check returned $healthStatus"
}
```

Expected: no output and no exception. Stop if it fails; do not build an app
image with an unverified key.

- [ ] **Step 3: Build all images locally**

Using the two variables from Step 2, run:

```powershell
docker build --platform linux/amd64 -t fleetmap-app:latest --target runner `
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=$prodSupabaseUrl" `
  --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$prodPublishableKey" .
if ($LASTEXITCODE -ne 0) { throw 'fleetmap-app build failed' }

docker build --platform linux/amd64 -t fleetmap-sync:latest --target sync .
if ($LASTEXITCODE -ne 0) { throw 'fleetmap-sync build failed' }

docker build --platform linux/amd64 -t fleetmap-driver-session:latest `
  --target driver-session .
if ($LASTEXITCODE -ne 0) { throw 'fleetmap-driver-session build failed' }
```

Expected: all three builds exit zero. No command passes a server secret as a
build argument.

- [ ] **Step 4: Smoke-test the built worker image**

Run the driver-session image with dummy, non-secret values. The liveness,
preflight, and malformed-body checks below never contact either upstream, so
there is no reason to expose the production `.env` through `docker inspect`:

```powershell
docker run --rm -d --name fleetmap-driver-session-smoke `
  -e NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1 `
  -e SUPABASE_SECRET_KEY=dummy-service-key `
  -e BB_API_URL=http://127.0.0.1:1 `
  -e BB_API_USERNAME=dummy-fleet-user `
  -e BB_API_PASSWORD=dummy-fleet-password `
  -p 127.0.0.1:3199:3100 `
  fleetmap-driver-session:latest
if ($LASTEXITCODE -ne 0) { throw 'worker smoke container failed to start' }

try {
  $live = curl.exe -sS -w ' HTTP:%{http_code}' http://127.0.0.1:3199/
  if ($live -ne '{"ok":true} HTTP:200') { throw "bad liveness: $live" }

  $preflight = curl.exe -sS -o NUL -w '%{http_code}' -X OPTIONS `
    http://127.0.0.1:3199/
  if ($preflight -ne '204') { throw "bad preflight: $preflight" }

  $badJsonHeaders = (
    curl.exe -sS -D - -o NUL -X POST `
      -H 'Content-Type: application/json' `
      --data-binary '{' `
      http://127.0.0.1:3199/
  ) -join "`n"
  if ($badJsonHeaders -notmatch 'HTTP/\S+ 400' -or
      $badJsonHeaders -notmatch '(?im)^Cache-Control: no-store') {
    throw 'malformed-json response failed status or no-store check'
  }
} finally {
  docker rm -f fleetmap-driver-session-smoke | Out-Null
}
```

Do not submit a real rider token during this image smoke test.

- [ ] **Step 5: Regenerate the archive**

Resolve the git root and archive target before replacing the old artifact.
Confirm the target is a direct child named `fleetmap-images.tar.gz` of this
repository, then save the three explicit tags, gzip with force, and verify the
intermediate `.tar` is removed.

```powershell
$workspaceRoot = (Resolve-Path '.').Path
$gitRoot = (Resolve-Path (git rev-parse --show-toplevel)).Path
if ($workspaceRoot -ne $gitRoot -or
    (Split-Path -Leaf $workspaceRoot) -ne 'fleetmap') {
  throw "unexpected workspace root: $workspaceRoot"
}
$archiveTar = Join-Path $workspaceRoot 'fleetmap-images.tar'
$archiveGzip = "$archiveTar.gz"
if ((Split-Path -Parent $archiveGzip) -ne $workspaceRoot -or
    (Split-Path -Leaf $archiveGzip) -ne 'fleetmap-images.tar.gz') {
  throw "unexpected archive target: $archiveGzip"
}

docker save -o $archiveTar `
  fleetmap-app:latest fleetmap-sync:latest fleetmap-driver-session:latest
if ($LASTEXITCODE -ne 0) { throw 'docker save failed' }

& 'C:\Program Files\Git\usr\bin\gzip.exe' -f $archiveTar
if ($LASTEXITCODE -ne 0) { throw 'gzip failed' }
if (-not (Test-Path -LiteralPath $archiveGzip) -or
    (Test-Path -LiteralPath $archiveTar)) {
  throw 'archive packaging did not leave exactly the gzip artifact'
}
```

- [ ] **Step 6: Inspect provenance and contents**

Run:

```powershell
tar -xOzf fleetmap-images.tar.gz index.json
docker image inspect fleetmap-app:latest fleetmap-sync:latest `
  fleetmap-driver-session:latest `
  --format "{{index .RepoTags 0}} {{.Os}}/{{.Architecture}} {{.Created}} {{.Id}}"
```

Expected: the archive contains all three tags and every image reports
`linux/amd64`.

Compute and record:

```powershell
Get-FileHash -Algorithm SHA256 .\fleetmap-images.tar.gz
Get-Item .\fleetmap-images.tar.gz | Select-Object Length, LastWriteTimeUtc
```

- [ ] **Step 7: Re-probe the unchanged production edge**

Run read-only checks:

```text
GET https://fleet.ysz.life/api/health
GET https://fleet.ysz.life/api/driver-session
OPTIONS https://fleet.ysz.life/api/driver-session
```

Record the exact pre-deploy state. Do not claim the verification swap is live
until Yanis ships the archive and a fresh token proves it.

- [ ] **Step 8: Final requirements audit**

Re-read
`docs/specs/2026-07-31-driver-session-cutover-design.md` line by line. Match
each requirement to a test, command, document, or explicitly recorded upstream
blocker. If any item lacks evidence, fix or report it before handoff.

- [ ] **Step 9: Prepare the human-gated production handoff**

Do not attempt to deploy without working VPS authorization. Report:

- the artifact's absolute path, size, UTC timestamp, and SHA-256;
- the four required secret-file variable names, never their values;
- checksum verification, `scp`, `docker load`, Compose recreation, log, health,
  and rollback commands from the deployment runbook;
- the unchanged pre-deploy production probe results;
- the safe stdin command for a fresh controlled token proof;
- a ready-to-send note asking Bubble Box for the corrected current rider login
  path or a valid test fixture, because the supplied legacy path returned 404
  and the documented login rejected that account.

This is a release-ready handoff, not a claim that the new image is live.
