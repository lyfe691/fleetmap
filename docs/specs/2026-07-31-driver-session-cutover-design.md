# Driver-session Bubble Box cutover

**Date:** 2026-07-31
**Status:** approved for implementation by Yanis's advance authorization to
complete the overnight handoff autonomously

## Outcome

FleetMap's public `POST /api/driver-session` exchanges Bubble Box's
short-lived `fleetAuthToken` for a durable Supabase session. Bubble Box owns
rider-token verification. FleetMap keeps its per-driver Supabase identity and
RLS model, while Roman's rider app keeps drivers signed in through Supabase
refresh instead of a second password.

The server-side verifier already exists on `main`. This cutover finishes the
production boundary around it: hardens the public HTTP service and live-test
tool, makes the login service visible in `/api/health`, corrects the living
documentation, and produces a fresh three-image deployment archive.

## Verified upstream contract

Bubble Box's live OpenAPI document at
`https://upgrade.bubblebox.ch/api/v2/docs.jsonopenapi` defines:

- `GET /api/v2/riders/fleet-auth-token`
  - header `accessToken`: the rider's existing JWT access token
  - response: `{ data: { username, loginStatus, fleetAuthToken }, status }`
- `POST /api/v2/fleet/verify-rider-token`
  - header `accessToken`: FleetMap's fleet-operator JWT
  - body: `{ riderAuthToken: fleetAuthToken }`
  - response: `{ id: integer, fullName: string }`
- `POST /api/v2/fleet/authentication-token`
  - body: FleetMap's fleet username and password
  - response: `{ data: { loginToken }, status }`

The rider token is purpose-issued for FleetMap and lives approximately two
minutes. The returned integer `id` is the same rider id used by
`/api/v2/fleet/rider-routes` and stored as text in
`vehicles.rider_ref`. FleetMap discards `fullName`.

Roman also supplied a legacy rider-login path and a staging test account. On
2026-07-31 the path returned `404`, while the documented v2 authentication
endpoint rejected the account with `401 Bad credentials`. No credential or
token from those probes is stored in the repository or written to disk.
That upstream test-fixture issue does not change the implementation contract,
but it prevents a real-token end-to-end proof until Bubble Box corrects the
path or account.

## Token boundaries

Exactly five tokens exist and must not be conflated:

1. **Bubble Box rider access token (`loginToken`):** returned by rider
   authentication, owned and persisted by the Bubble Box rider app.
2. **Bubble Box `fleetAuthToken`:** fetched on demand from
   `GET /api/v2/riders/fleet-auth-token`, with token 1 in the `accessToken`
   header, and read from `data.fleetAuthToken`. It lives approximately two
   minutes and only bootstraps or reacquires a FleetMap session.
3. **Bubble Box fleet-service `loginToken`:** minted by
   `POST /api/v2/fleet/authentication-token`, cached only inside FleetMap
   (approximately 24-hour upstream lifetime), and sent as the private
   verification request's `accessToken` header.
4. **Supabase `access_token`:** returned to Roman's app by FleetMap and used
   for authenticated GPS writes.
5. **Supabase `refresh_token`:** returned with token 4, persisted by the app,
   and used to keep the driver signed in.

`riderAuthToken` is a private request field name, not a sixth token. FleetMap
puts the exact value of token 2 in that field when it calls Bubble Box.

None of the first three values may be logged. Supabase session tokens are
handled only by the HTTPS response and the rider app's session persistence;
diagnostic output must redact them.

## Request and data flow

1. Roman's app completes Bubble Box login, persists the rider `loginToken`,
   then uses it as `accessToken` on
   `GET /api/v2/riders/fleet-auth-token` and reads
   `data.fleetAuthToken`.
2. The app immediately sends:

   ```http
   POST https://fleet.ysz.life/api/driver-session
   Content-Type: application/json

   { "token": "<fleetAuthToken>" }
   ```

   The public field remains `token` for compatibility with the call Roman
   already wired and exercised through CORS. `riderAuthToken` is intentionally
   an internal upstream field name.
3. The driver-session service mints or reuses its fleet-service `loginToken`,
   sends it to Bubble Box as the private `accessToken` header, and forwards
   the submitted value as `{ riderAuthToken }`.
4. Bubble Box returns the rider id. FleetMap maps it through
   `vehicles.rider_ref`.
5. FleetMap uses the assigned Supabase driver identity, or auto-provisions a
   passwordless identity and assigns the matching vehicle on first login.
6. FleetMap returns the Supabase access and refresh tokens with explicit
   no-store headers.
7. Roman's app calls `setSession`, persists the Supabase session, and uses the
   Supabase access token for `POST /api/location`. Normal app starts and GPS
   requests do not mint or exchange another Bubble Box token.
8. If Supabase refresh ultimately fails, the app uses its still-valid rider
   access token to request a new `fleetAuthToken`, then repeats the exchange.
   Interactive Bubble Box login is required only when the rider access token
   can no longer mint one.

## HTTP and failure behavior

- `OPTIONS` returns `204` with CORS headers.
- `GET` returns `200 { "ok": true }` for internal/public liveness checks.
- `POST` accepts a JSON body no larger than 16 KiB, measured in bytes. Once the
  limit is exceeded, the service stops buffering and returns `413`.
- Successful session responses include `Cache-Control: no-store` and
  `Pragma: no-cache`.
- Bubble Box requests have a finite timeout. A hung token mint or verification
  request cannot hold a login connection forever.
- `400`: malformed JSON or missing/empty `token`.
- `401`: Bubble Box rejected the short-lived rider token with `403`.
- `403`: Bubble Box verified the rider, but no FleetMap vehicle has the
  returned `rider_ref`.
- `413`: request body exceeds the byte limit.
- `500`: FleetMap fleet credentials fail, Bubble Box is unavailable, its
  success response breaks contract, or Supabase session minting fails.

The distinction between `401` and `500` is load-bearing: the app may acquire a
fresh rider token after `401`, but should use bounded backoff rather than force
a rider login after `500`.

## Operational visibility

`GET /api/health` probes `http://driver-session:3100` in production and reports
`driver_session: "ok" | "down"`. The login service gates overall health when
configured. An unset `DRIVER_SESSION_URL` reports `null` and remains non-gating
for local development.

This is a liveness probe. It proves that the container answers, not that the
current Bubble Box credentials can complete a verification request. The
real-token smoke test remains the readiness proof for a cutover.

## Build and deployment safety

- Production currently has the CORS/liveness driver-session image, not the
  verification-swap artifact described here. *(Stale: the swap was deployed
  2026-08-10 and proven live 2026-08-11 — see `docs/HANDOFF.md`.)*
- `.dockerignore` excludes the retired `.driver-auth-dev` keypair and
  `fleetmap-images.tar.gz`; neither enters Docker build context or cache.
- No database migration is required for this cutover.
- The VPS must have `/opt/fleetmap/.env.driver-session` with:
  `SUPABASE_SECRET_KEY`, `BB_API_URL`, `BB_API_USERNAME`, and
  `BB_API_PASSWORD`.
- The previous local-signature verification variable is obsolete.
- Build all three linux/amd64 tags locally and save them in
  `fleetmap-images.tar.gz`. The VPS must never build images.
- `redeploy.sh` loads the archive and starts the stack with `--no-build`.

## Test strategy

Automated tests cover:

- fleet token mint, caching, authenticated header, one 401 re-mint, and request
  timeout;
- rider-token verification request/response and error classification;
- exchange decisions for existing, newly provisioned, unmapped, invalid, and
  infrastructure-failure paths;
- HTTP request parsing, byte limit, CORS, anti-cache headers, and response
  mapping through a pure/testable handler;
- health aggregation with the driver-session service configured, absent, and
  down;
- diagnostic redaction and failure exit behavior where practical.

Release verification covers typecheck, the complete unit suite, targeted lint,
Next production build, Docker Compose rendering, three linux/amd64 image
builds, archive tag/platform inspection, and public production liveness probes.

A real-token proof additionally covers:

1. rider access token to fresh `fleetAuthToken`;
2. local verifier using FleetMap's fleet account;
3. production `/api/driver-session`;
4. `setSession` and Supabase refresh;
5. authenticated `POST /api/location` against a controlled mapped test
   vehicle.

Step 5 is state-changing and must use a throwaway or explicitly approved test
vehicle with cleanup.

## Scope boundaries

This cutover does not add server-side replay storage, rate limiting, a
transactional provisioning redesign, or new RLS column grants. Those are
independent hardening projects with database/behavior rollout risk. The
existing RLS posture and offboarding semantics must be recorded as follow-up
risk, not silently expanded inside the login release.
