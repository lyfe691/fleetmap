# Driver Session Request Diagnostics

**Date:** 2026-08-10

## Goal

Make one TestFlight login diagnostically decisive without recording rider tokens,
request bodies, credentials, IP addresses, or other personal data. The change is
observability-only: authentication, CORS, routing, rider mapping, and session
minting behavior remain unchanged.

## Context

The driver-session worker currently logs only exchange outcomes such as
`token_rejected`, `unmapped_rider`, and `session_minted`. A CORS preflight,
malformed JSON, or a request with a missing or incorrectly named `token` field
returns a response without a log event. Consequently, an empty log cannot tell
us whether TestFlight made no request or made one that stopped at the HTTP
boundary.

## Approaches considered

1. **Instrument the driver-session HTTP boundary (selected).** This is narrowly
   scoped, testable, and exposes every request that reaches the exact worker
   route without changing its behavior.
2. **Ask the RiderApp developer for a development-console trace.** This is useful
   if no request reaches the worker, but it depends on another person and does
   not first close FleetMap's observability gap.
3. **Enable global Caddy access logging.** This would also reveal wrong paths,
   but it is broader, noisier, and risks collecting client-network metadata that
   is unnecessary for the first diagnostic pass.

## Design

`createDriverSessionHandler` will emit two structured lifecycle events through
its existing injected logger:

- `request_received` when a request reaches the worker;
- `request_completed` immediately before the worker sends its response.

Both events carry a request-local numeric identifier plus only these fields:

- HTTP method;
- URL pathname with the query string discarded;
- `Origin`, when present;
- `Content-Type`, when present;
- the value of `Access-Control-Request-Headers`, which contains header names
  rather than request-header values;
- response status on `request_completed`.

No body, token, authorization value, cookie, user agent, client IP, query string,
or response body is logged. Request-stream failures emit `request_aborted` with
the same identifier, method, and pathname so that an incomplete request is not
silent.

The existing response codes, headers, bodies, and exchange events remain byte
for byte equivalent from the client's perspective. No additional CORS header is
allowed until a captured preflight proves one is required.

## Diagnostic interpretation

One logout/login attempt while following `driver-session` logs will distinguish:

- no `request_received`: the exact worker route was not reached;
- `OPTIONS` only: the browser stopped after preflight, with the requested header
  names available for comparison;
- `POST` followed by `400`: the app sent malformed JSON or the wrong public body
  contract;
- `token_rejected`: Bubble Box rejected or expired the rider token;
- `unmapped_rider`: verification succeeded and only operations mapping remains;
- `session_minted`: the exchange completed successfully;
- `exchange_failed`: an internal or upstream failure occurred after a valid
  public request.

If no request reaches the worker, the next step is to ask Roman for the exact
TestFlight build, request URL, and a redacted development-console trace. We will
not infer that the RiderApp is wrong from silence alone.

## Verification and release

Tests will be written first to prove lifecycle logging for preflight, malformed
JSON, missing-token JSON, and a completed exchange, including assertions that
sensitive body and token values never appear in serialized log fields. After
the focused tests pass, run the full test suite, typecheck, lint, and production
build.

Build only the `linux/amd64` `fleetmap-driver-session:latest` target and package
it in a checksum-verified archive. The VPS rollout will back up the currently
tagged driver-session image, load the diagnostic image, recreate only the
`driver-session` service, and recheck health, liveness, CORS, and invalid-request
behavior before the single TestFlight retry.
