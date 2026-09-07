# Driver Session Request Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one TestFlight login reveal exactly how far its request reaches the FleetMap driver-session exchange without logging secrets or changing client-visible behavior.

**Architecture:** Extend the existing `createDriverSessionHandler` boundary with structured request lifecycle events through its injected logger. Generate a process-local numeric request identifier, record a query-free pathname and selected safe header metadata at ingress, record the final status before each response, and record an aborted request once. Keep Bubble Box verification, CORS policy, response bodies, rider mapping, and session minting unchanged.

**Tech Stack:** Node.js 22 HTTP server, TypeScript 5, Vitest 4, pnpm 11, esbuild, Docker BuildKit, Docker Compose.

## Global Constraints

- Never log a rider token, request body, response body, credential, authorization value, cookie, user agent, client IP, or query string.
- Log only method, query-free pathname, origin, content type, requested CORS header names, request-local identifier, and final status.
- Do not change authentication, CORS, routing, rider mapping, response status, response headers, response body, or session behavior.
- Do not allow an additional CORS header until a captured preflight proves it is required.
- Build for `linux/amd64`; the VPS must never build an image.
- Deploy only the driver-session service for this observability change and save a rollback image first.

---

## File structure

- `lib/driver-auth/http.ts`: owns safe HTTP-boundary metadata extraction and request lifecycle logging.
- `lib/driver-auth/http.test.ts`: proves every newly observable branch and secret redaction.
- `docs/driver-session-api.md`: documents the event meanings for the RiderApp handoff.
- `docs/deployment.md`: documents the operator command and one-login interpretation.
- `README.md`, `CLAUDE.md`, `docs/HANDOFF.md`: replace the stale pre-cutover production status with the 2026-08-10 truth.
- `fleetmap-driver-session-diagnostics.tar.gz` and matching `.sha256`: generated release artifacts; excluded from git.

---

### Task 1: Test-drive safe request lifecycle logging

**Files:**
- Modify: `lib/driver-auth/http.test.ts`
- Modify: `lib/driver-auth/http.ts`

**Interfaces:**
- Consumes: `DriverSessionHttpDeps.log(level, event, fields)`.
- Produces: `request_received`, `request_completed`, and `request_aborted` structured events; no public HTTP interface changes.

- [ ] **Step 1: Add failing lifecycle and redaction assertions**

Extend the existing preflight test so it sends diagnostic metadata and expects both lifecycle events:

```ts
const querySecret = "query-secret-sentinel"
const response = await fetch(
  `${testServer.baseUrl}/api/driver-session?token=${querySecret}`,
  {
    method: "OPTIONS",
    headers: {
      Origin: "capacitor://localhost",
      "Access-Control-Request-Headers": "content-type,x-rider-client",
    },
  }
)

expect(testServer.logs).toEqual([
  {
    level: "info",
    event: "request_received",
    fields: {
      request_id: 1,
      method: "OPTIONS",
      path: "/api/driver-session",
      origin: "capacitor://localhost",
      requested_headers: "content-type,x-rider-client",
    },
  },
  {
    level: "info",
    event: "request_completed",
    fields: {
      request_id: 1,
      method: "OPTIONS",
      path: "/api/driver-session",
      origin: "capacitor://localhost",
      requested_headers: "content-type,x-rider-client",
      status: 204,
    },
  },
])
expect(JSON.stringify(testServer.logs)).not.toContain(querySecret)
```

Add focused assertions to the existing malformed-JSON, missing-token, and successful-exchange tests:

```ts
expect(testServer.logs.at(-1)).toMatchObject({
  level: "info",
  event: "request_completed",
  fields: { method: "POST", status: 400 },
})
```

For the successful request, explicitly send `Content-Type: application/json`, expect `content_type: "application/json"`, expect final status `200`, and assert the submitted token is absent from serialized logs.

Add an aborted-stream test using the existing `openStreamingRequest` helper:

```ts
it("logs an aborted request once without logging its partial body", async () => {
  const partialSecret = "partial-body-secret-sentinel"
  const testServer = await startServer()
  try {
    const { request } = openStreamingRequest(testServer.port)
    request.write(partialSecret)
    request.destroy()

    await vi.waitFor(() => {
      expect(testServer.logs.filter((entry) => entry.event === "request_aborted"))
        .toHaveLength(1)
    })
    expect(JSON.stringify(testServer.logs)).not.toContain(partialSecret)
  } finally {
    await testServer.close()
  }
})
```

Import `vi` from Vitest for `vi.waitFor`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
pnpm exec vitest run lib/driver-auth/http.test.ts
```

Expected: FAIL because no `request_received`, `request_completed`, or `request_aborted` events exist yet. Confirm the failure is an assertion mismatch, not a syntax or setup error.

- [ ] **Step 3: Implement metadata extraction and lifecycle events**

Add query-free metadata helpers beside `DriverSessionHttpDeps`:

```ts
function pathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://driver-session.internal").pathname
  } catch {
    return "/"
  }
}

function requestFields(
  req: IncomingMessage,
  requestId: number
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    request_id: requestId,
    method: req.method ?? "UNKNOWN",
    path: pathname(req.url),
  }
  if (req.headers.origin) fields.origin = req.headers.origin
  if (req.headers["content-type"]) {
    fields.content_type = req.headers["content-type"]
  }
  if (req.headers["access-control-request-headers"]) {
    fields.requested_headers = req.headers["access-control-request-headers"]
  }
  return fields
}
```

Create the counter once per handler, log ingress once per request, and route every response through a completion logger:

```ts
let nextRequestId = 0

return (req, res) => {
  const fields = requestFields(req, ++nextRequestId)
  deps.log("info", "request_received", fields)

  const complete = (status: number) => {
    deps.log("info", "request_completed", { ...fields, status })
  }
  const respond = (status: number, body: Record<string, unknown>) => {
    complete(status)
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  }

  if (req.method === "OPTIONS") {
    complete(204)
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }
  // Existing GET, method validation, and POST flow remain unchanged.
}
```

Pass the safe fields into `handlePost`. Replace its silent request error with one idempotent abort handler and listen to both Node abort signals:

```ts
const abort = () => {
  if (finished) return
  finished = true
  deps.log("warn", "request_aborted", fields)
}

req.on("aborted", abort)
req.on("error", abort)
```

Do not log chunks, the parsed token, exception text, headers outside the approved list, or response bodies.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm exec vitest run lib/driver-auth/http.test.ts
```

Expected: all HTTP-boundary tests PASS, including the abort test, with no unhandled socket errors.

- [ ] **Step 5: Format and lint the two files**

Run:

```powershell
pnpm exec prettier --write lib/driver-auth/http.ts lib/driver-auth/http.test.ts
pnpm exec eslint lib/driver-auth/http.ts lib/driver-auth/http.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit the tested boundary change**

```powershell
git add -- lib/driver-auth/http.ts lib/driver-auth/http.test.ts
git diff --cached --check
git commit -m "feat(auth): log driver session request lifecycle"
```

---

### Task 2: Document the events and reconcile production truth

**Files:**
- Modify: `docs/driver-session-api.md`
- Modify: `docs/deployment.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/HANDOFF.md`

**Interfaces:**
- Consumes: the event names and safe fields from Task 1.
- Produces: one authoritative operator interpretation and current 2026-08-10 deployment status.

- [ ] **Step 1: Add the diagnostic event contract**

After the error table in `docs/driver-session-api.md`, add a `## Server diagnostics` section stating:

```markdown
During a controlled login test, follow the worker with
`docker compose -f docker-compose.prod.yml logs -f --since=5s driver-session`.
`request_received` proves that the exact worker route was reached;
`request_completed` records its status. `OPTIONS` without a following `POST`
means the browser stopped after preflight. A `POST` ending in `400` means the
public JSON contract was malformed. `token_rejected`, `unmapped_rider`, and
`session_minted` remain the verification, mapping, and success outcomes.

Lifecycle logs contain only a process-local request id, method, query-free
pathname, origin, content type, requested CORS header names, and final status.
They never contain the token, body, credentials, authorization values, cookies,
user agent, client IP, query string, or response body.
```

- [ ] **Step 2: Add the one-login operations procedure**

In `docs/deployment.md`, expand the driver-session log operation with the same command and event interpretation. Explicitly state that no event means the exact worker route was not reached and must not be interpreted as Bubble Box rejecting a token.

- [ ] **Step 3: Replace stale pre-cutover status**

Update only the current-status sections, leaving chronological specs and plans historical:

- `README.md`: production runs the Bubble Box verification cutover and the health check covers `driver_session`; exact TestFlight proof remains pending.
- `CLAUDE.md`: date M20 current truth `2026-08-10`, record deployed commit `530b117`, and make request-boundary diagnostics plus one controlled TestFlight retry the next action.
- `docs/HANDOFF.md`: date the authoritative section `2026-08-10`, record the completed three-image deploy and healthy services, and replace the obsolete fixture blocker with the current TestFlight observability gap.
- `docs/deployment.md`: convert the old “next deploy” warnings into standing requirements and state that the verification cutover is live while the controlled real-client proof is pending.
- `docs/driver-session-api.md`: replace the pre-deploy warning with the deployed-server/pending-client-proof truth.

Do not rewrite the dated investigation below the authoritative `docs/HANDOFF.md` section or historical design/plan documents.

- [ ] **Step 4: Verify documentation consistency**

Run:

```powershell
rg -n "does not yet have the verification|still to ship|Production currently has the CORS/liveness image|not that cutover" README.md CLAUDE.md docs/HANDOFF.md docs/deployment.md docs/driver-session-api.md
git diff --check
```

Expected: `rg` returns no matches in current operational documents; `git diff --check` exits 0.

- [ ] **Step 5: Commit the documentation update**

```powershell
git add -- README.md CLAUDE.md docs/HANDOFF.md docs/deployment.md docs/driver-session-api.md
git diff --cached --check
git commit -m "docs(auth): record deployed cutover diagnostics"
```

---

### Task 3: Verify and package the diagnostic image

**Files:**
- Read: `package.json`
- Read: `Dockerfile`
- Generate: `fleetmap-driver-session-diagnostics.tar.gz`
- Generate: `fleetmap-driver-session-diagnostics.tar.gz.sha256`

**Interfaces:**
- Consumes: committed Task 1 worker code and Task 2 operational documentation.
- Produces: a tested `linux/amd64` driver-session image plus checksum for a controlled VPS rollout.

- [ ] **Step 1: Confirm the worktree and commit scope**

Run:

```powershell
git status --short --branch
git log -3 --oneline
git diff HEAD~2..HEAD --stat
```

Expected: no uncommitted changes; the last commits are the lifecycle implementation and documentation update, preceded by the approved design commit.

- [ ] **Step 2: Run the complete source verification suite**

Run each command separately and stop on the first failure:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: tests, typecheck, and build exit 0. Lint exits 0 with no new warning relative to the existing 22-warning baseline.

- [ ] **Step 3: Build and inspect only the driver-session image**

```powershell
docker build --platform linux/amd64 -t fleetmap-driver-session:latest --target driver-session .
docker image inspect fleetmap-driver-session:latest --format '{{index .RepoTags 0}} {{.Os}}/{{.Architecture}} {{.Id}}'
```

Expected: tag `fleetmap-driver-session:latest`, platform `linux/amd64`, and a non-empty image id.

- [ ] **Step 4: Smoke-test the bundled worker without secrets**

Run the image with dummy non-secret values on an unused local port, wait for the startup event, then prove liveness, preflight lifecycle events, and a missing-token `400`. Remove the container afterward. The startup must fail only if a required dummy variable was omitted; no real credential is used or printed.

```powershell
docker run --rm -d --name fleetmap-driver-session-diagnostics-smoke -p 3199:3100 `
  -e NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 `
  -e SUPABASE_SECRET_KEY=dummy-secret `
  -e BB_API_URL=http://127.0.0.1:3999 `
  -e BB_API_USERNAME=dummy-user `
  -e BB_API_PASSWORD=dummy-password `
  fleetmap-driver-session:latest
curl.exe -fsS http://127.0.0.1:3199/
curl.exe -sS -o NUL -w "%{http_code}" -X OPTIONS `
  -H "Origin: capacitor://localhost" `
  -H "Access-Control-Request-Method: POST" `
  -H "Access-Control-Request-Headers: content-type,x-rider-client" `
  http://127.0.0.1:3199/api/driver-session
curl.exe -sS -o NUL -w "%{http_code}" -X POST `
  -H "Content-Type: application/json" `
  --data "{}" http://127.0.0.1:3199/api/driver-session
docker logs fleetmap-driver-session-diagnostics-smoke
docker rm -f fleetmap-driver-session-diagnostics-smoke
```

Expected: liveness JSON `{"ok":true}`, status `204`, status `400`, and lifecycle events containing no dummy secret/password values.

- [ ] **Step 5: Create and verify the release archive**

Use the same gzip tooling already used for the successful three-image cutover:

```powershell
docker save fleetmap-driver-session:latest | gzip > fleetmap-driver-session-diagnostics.tar.gz
$hash = (Get-FileHash -Algorithm SHA256 fleetmap-driver-session-diagnostics.tar.gz).Hash.ToLowerInvariant()
"$hash  fleetmap-driver-session-diagnostics.tar.gz" | Set-Content -Encoding ascii fleetmap-driver-session-diagnostics.tar.gz.sha256
Get-Item fleetmap-driver-session-diagnostics.tar.gz, fleetmap-driver-session-diagnostics.tar.gz.sha256
Get-Content fleetmap-driver-session-diagnostics.tar.gz.sha256
docker load -i fleetmap-driver-session-diagnostics.tar.gz
```

Expected: archive and checksum files exist, the checksum is 64 lowercase hexadecimal characters, and `docker load` reports `fleetmap-driver-session:latest` loaded.

- [ ] **Step 6: Record the exact handoff values**

Record for the user:

- current git commit;
- absolute archive path;
- archive byte size;
- SHA-256;
- image id and `linux/amd64` platform;
- test/typecheck/lint/build results;
- the exact checksum-verified VPS upload, rollback, load, service-recreate, and health commands.

Do not push, upload, SSH, redeploy, or send Roman a message without Yanis's explicit next instruction.
