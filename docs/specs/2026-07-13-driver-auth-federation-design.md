# Driver auth federation — kill the double-login

> **SUPERSEDED FOR CURRENT IMPLEMENTATION AND OPERATIONS.** This document
> preserves the 2026-07-13/22 design history, including rejected local
> signature verification and the later introspection discussion. The
> authoritative design is
> `docs/specs/2026-07-31-driver-session-cutover-design.md`; the authoritative
> client and deployment instructions are `docs/driver-session-api.md` and
> `docs/deployment.md`. Read the final 2026-07-31 addendum below for the
> corrected outcome.

**Date:** 2026-07-13 (rewritten after review) · **Historical status:**
implemented 2026-07-22 and subsequently superseded at the verification
boundary by Bubble Box server-side token verification.

> **Reviewed 2026-07-22** (post M17 self-host, M18 real API, M19 retirements) —
> the core design holds; see "2026-07-22 review" at the end for what today's
> facts confirmed, what drifted, and the revised hosting recommendation
> (internal exchange service instead of an Edge Function). Read that section
> together with this spec before building.

**Author's note:** the first draft of this spec recommended registering Bubble
Box as a trusted Supabase third-party issuer (or using `signInWithIdToken` with a
`bubblebox` provider). Review killed both: Supabase third-party auth is a closed
list of named providers and neither knob accepts a bring-your-own issuer — see
"Considered and rejected." The buildable design is a small **Supabase Edge
Function** that exchanges a Bubble Box token for a Supabase session. It changes
**no RLS** and keeps our whole `auth.uid()` model — driver policies,
`provision-driver`, `fake-gps`, `seed-stops` — working untouched. Read "Open
questions" first; the whole thing still hinges on one capability we don't yet
know Bubble Box has.

**Build-time caveat:** the exact sanctioned Supabase mechanism for minting a
session for a known user from a trusted backend (see "The exchange") must be
confirmed against the current Supabase docs when this is built — the admin API
surface moves, and this spec names the shape, not the frozen call.

---

## Problem

A driver logs in **twice**: once into the Bubble Box app (their routes), and
again into our Supabase (for GPS tracking). The second login is the wart. It
exists because our GPS ingest is RLS-scoped per driver, so the driver's app must
hold a **Supabase** identity — a second credential on top of the Bubble Box one.

This is deliberately parked in `docs/HANDOFF.md` ("drivers log in twice … untouched,
deliberately"). It is not sloppiness: two independent systems each own their auth,
and our RLS-per-driver model — a genuinely good security property — *requires* a
per-driver identity. The fix is federation, not throwing that model away.

## Current state (the mechanics we're changing)

- **Driver identity:** a plain Supabase Auth user (email/password, e.g.
  `rider_zurichcity1@bb.ch`), created by `scripts/provision-driver.ts` with the
  secret key. No role claim.
- **Vehicle assignment:** `vehicles.assigned_user_id` (unique) links one vehicle
  to one Supabase driver. `provision-driver` sets it.
- **GPS write path:** `POST /api/location` takes a Supabase access token as a
  Bearer, runs as that user (`createUserClient(token)`), and RLS scopes every
  read/write to "the vehicle where `assigned_user_id = auth.uid()`." The app never
  names a vehicle — the DB derives it from who is authenticated.
- **The mapping asset:** each vehicle row also carries `rider_ref` (M15) — the
  Bubble Box rider id, used by the order sync. So a vehicle already knows *both*
  its Bubble Box rider (`rider_ref`) and its Supabase driver (`assigned_user_id`).

That last point is the whole design. `rider_ref` is already the bridge between
"who Bubble Box says logged in" and "which Supabase driver owns this vehicle." We
don't need to change what the driver *is* inside Supabase — we need a way to turn
a Bubble Box login into that existing Supabase driver without a second password.

## Goal / non-goals

**Goal:** the driver authenticates to **Bubble Box only**; GPS tracking works with
no second credential, while the per-driver RLS scope on writes is preserved
exactly as today.

**Non-goals:** changing the dashboard/dispatcher identities; changing the shape of
`POST /api/location` (it stays a Bearer-token, RLS-scoped write); changing any RLS
policy; building a driver account-management UI. This spec is driver identity only.

## Recommended design: a token-exchange Edge Function

Keep everything about the Supabase side — the driver users, `assigned_user_id`,
every `auth.uid()` policy — exactly as it is. Add one server-side seam that trades
a Bubble Box token for a normal Supabase session, and run it **inside Supabase's
own environment** (a Supabase Edge Function) so the service-role key never touches
our VPS or app image.

### The flow

```
Roman's app                Supabase Edge Function            Supabase Auth + DB
  BB JWT ───POST──►  verify RS256 sig vs BB JWKS (cached)
                     check iss + aud + exp
                     require rider audience/claim
                     sub ──► vehicles.rider_ref ──► assigned_user_id ──┐
                     find-or-provision that driver user ◄──────────────┘
                     mint a Supabase session for that user ────────────►
  session ◄──return─ { access_token, refresh_token }
  … then POST /api/location with the Supabase access token, exactly as today,
    and let supabase-js refresh the session itself for the rest of the shift.
```

### The exchange (what the function does)

1. **Verify the Bubble Box JWT locally.** Fetch Bubble Box's JWKS once and cache
   it (respecting key rotation via `kid`); verify the RS256/ES256 signature.
   **No introspection call** — local signature verification is the point, so a
   Bubble Box API blip doesn't stall driver auth beyond the token's own lifetime.
2. **Validate claims.** `exp`/`iat` fresh; `iss` equals the agreed Bubble Box
   issuer; **`aud` equals the value we pinned** (reject anything else). Crucially,
   confirm the token is a **rider** token, not a Bubble Box customer/staff token —
   see the token contract and the trust-scope note in Security.
3. **Map to a vehicle.** `sub` is the rider id. Look up
   `vehicles.rider_ref = sub` → its `assigned_user_id`. No mapped vehicle, or a
   vehicle with a null `assigned_user_id` → **`401`/`403`, no session minted**.
4. **Find-or-provision the driver user.** If `assigned_user_id` is set, use it. If
   the vehicle has a `rider_ref` but no `assigned_user_id` yet (a van that only the
   sync has touched), auto-create a driver Auth user, set `assigned_user_id`, and
   proceed — this is the "no manual `provision-driver` step" win, done lazily on
   first federated login. No password is ever set; the user exists only as an RLS
   principal.
5. **Mint a Supabase session for that user and return it.** The app stores it and
   uses it as the Bearer for `POST /api/location`, identical to today.
   **Build-time:** confirm the current sanctioned mint path — at time of writing
   that is admin-generate a magic-link / OTP for the user's email and immediately
   `verifyOtp({ type, token_hash })` inside the function to obtain a real
   `{ access_token, refresh_token }` pair. If Supabase exposes a first-class
   "create session for user id" admin call by build time, prefer it. Either way
   the mechanism lives **only** in the Edge Function, never in our Next app.

### Roman's app

Stop the second login. On startup (and whenever the Supabase session can't be
refreshed), POST the Bubble Box token it already holds to the Edge Function, store
the returned Supabase session, and use it for `POST /api/location` exactly as it
does today. `supabase-js` refreshes that session on its own for the rest of the
shift; the exchange only re-runs when the refresh token itself expires or is
revoked. One login, silent.

### Why this is the design

- **Zero RLS changes.** Every driver policy stays `assigned_user_id = auth.uid()`
  (0001, 0004, 0005). Because the minted session is a genuine Supabase session for
  the mapped driver user, `auth.uid()` resolves normally and no policy is touched.
  Consequences: no risky global policy flip, no `auth.uid()` uuid-cast hazard, and
  **`provision-driver`, `fake-gps`, and `seed-stops` all keep working unchanged**
  — they still authenticate as ordinary Supabase driver users.
- **No `role`-claim dependency.** The Bubble Box token is never presented to
  PostgREST/Realtime directly, so the requirement that an externally-issued JWT
  carry `role: "authenticated"` (which the rejected paths all impose) simply
  doesn't apply. Our own minted session already carries the right role.
- **Supabase-managed refresh.** The Bubble Box token bootstraps a Supabase session
  **once**; Supabase's own refresh keeps the all-day GPS stream alive. This
  decouples a locked-screen phone streaming for a whole shift from Bubble Box
  token freshness — the more robust operational choice for continuous tracking.
- **Service key stays inside Supabase.** Minting sessions needs admin rights; doing
  it in an Edge Function keeps the service-role key in Supabase's environment,
  honoring the CLAUDE.md rule that it never lives in a request handler or on the
  VPS. `POST /api/location` in our Next app stays a plain Bearer/RLS write with
  only the publishable key, as today.
- **`rider_ref` is the single join**, reusing the column the sync already
  maintains. Setup collapses to "set `rider_ref` on the vehicle" — the driver user
  auto-provisions on first login.

The cost, honestly stated: one Edge Function to write and operate, and per-driver
Supabase driver users continue to exist (auto-provisioned). That's a smaller
subsystem than the password lifecycle it replaces — no driver ever sets or resets
a password again — but it is not literally zero moving parts.

## The token contract (the ask for Dmytro)

On driver login, Bubble Box issues a short-lived **signed JWT** (RS256 or ES256):

- `sub` = the stable Bubble Box rider id — **the same value we store in
  `vehicles.rider_ref`** (settled once he picks the rider identifier for the sync).
- `iss`, `exp`, `iat` — standard claims.
- **`aud` pinned to a value we agree on**, so the Edge Function can reject tokens
  minted for any other Bubble Box surface.
- A way to tell a **rider** token apart from Bubble Box's customer/staff tokens —
  either a **dedicated audience** for the Fleetmap/rider surface, or an explicit
  claim like `type: "rider"`. This matters because verifying against Bubble Box's
  JWKS trusts *everything that key signs*; without a rider marker, a customer's
  token would also verify (see Security → trust scope).
- A **discoverable JWKS** endpoint (public keys) so the Edge Function verifies
  signatures locally without a shared secret and survives key rotation via `kid`.
- **No customer PII** — `sub` + standard claims + the rider marker only, consistent
  with the sync's zero-PII stance.

This rides on the same Fleetmap API auth Dmytro is already building for the order
sync; it is an additional claim/audience agreement, not a new subsystem on his
side.

## Considered and rejected

Both rejected paths were the original recommendation. They are recorded here so
this decision isn't relitigated.

- **Supabase Third-Party Auth (register Bubble Box as a trusted issuer).**
  Doesn't exist as a bring-your-own-issuer knob. Third-party auth is a **closed
  list of named providers** (Clerk, Firebase, Auth0, AWS Cognito, WorkOS). There
  is no "add an arbitrary OIDC issuer URL + JWKS" configuration, so the original
  step "register Bubble Box (issuer URL + JWKS)" is not a real config surface, and
  the `aud`/`iss` pinning it promised would have to live somewhere that doesn't
  exist. It would also require every Bubble Box rider token to carry
  `role: "authenticated"` or default to the `anon` Postgres role (a silent
  zero-rows → `409` failure through `POST /api/location`), plus a global RLS flip
  from `auth.uid()` to `rider_ref = auth.jwt()->>'sub'` that breaks every existing
  password-auth driver, `fake-gps`, and `seed-stops` at once.

- **`signInWithIdToken({ provider: 'bubblebox', token })`.** Fictional as written:
  the id-token grant accepts the built-in social providers, not an arbitrary
  `bubblebox` provider. Same `role`-claim requirement as above.

- **Custom OIDC Provider (`signInWithOAuth({ provider: 'custom:bubblebox' })`).**
  This *is* a real Supabase feature (launched 2026-04), but it's the **browser
  authorization-code redirect flow** — it needs Bubble Box to run a full OIDC
  authorization server (discovery doc, authorize + token endpoints, client
  id/secret), not just "sign a JWT + publish a JWKS." Worse, in a **native app**
  the redirect opens Bubble Box's IdP login page, and unless BB holds an SSO
  session cookie in the system browser (native logins don't create one), the
  driver sees a second login screen — i.e. it likely **wouldn't even kill the
  wart** this spec exists for. It's also plan-gated (Free plan caps custom
  providers). Rejected as heavier and not obviously solving the problem.

The Edge Function beats all three: it consumes exactly the JWT+JWKS contract we're
asking Dmytro for, needs no `role` claim, changes no RLS, and exchanges the token
the app already holds — no redirect, no second screen.

## Migration / transition

Near-trivial, because nothing about the Supabase side changes.

- **No RLS flip.** Policies stay `assigned_user_id = auth.uid()`. Nothing to
  migrate on the DB side beyond ensuring each real van's `rider_ref` is set (mostly
  already done for the sync).
- **Driver users auto-provision** on first federated login (exchange step 4), so
  there's no bulk user creation and no per-driver manual step.
- **`provision-driver` stays usable for dev.** It still creates a
  user+vehicle+`assigned_user_id` for local testing and for the `fake-gps` /
  `seed-stops` flows, which are unaffected.
- **Existing email/password driver users keep working throughout.** Their tokens
  still authenticate the old way; the Edge Function is purely additive. Once Roman's
  app cuts over to the exchange, the passwords are simply unused — no deletion is
  required, and none is load-bearing. If we later want to disable password login
  for drivers, that's a separate, optional hardening step, not part of cutover.
- **Roll out to one throwaway vehicle first** (the shared dev/prod DB rule from
  `HANDOFF.md` applies — never test against a real van): set its `rider_ref`,
  exchange a test token, confirm `POST /api/location` writes only that vehicle.

## Security considerations

- **RLS stays the security boundary, unchanged.** Writes remain scoped to one
  vehicle per identity by the same `auth.uid()` policies as today. The Edge Function
  doesn't widen the boundary; it only decides *which existing driver user* a Bubble
  Box login becomes.
- **No service-role key in prod.** Session minting runs in the Supabase Edge
  Function's environment; our Next app and the VPS never see the secret key.
- **Trust scope — the sharpest new risk.** Verifying against Bubble Box's JWKS
  trusts *every* token that key signs, including customer and staff tokens. The
  Edge Function therefore MUST reject any token that isn't a rider token (pinned
  `aud` and/or `type: "rider"` claim) *before* mapping `sub`. Without that check, a
  customer's valid Bubble Box token whose `sub` happened to collide with a
  `rider_ref` could mint a driver session. Pin `aud`; require the rider marker;
  reject on absence.
- **Unmapped `sub` mints nothing.** If `sub` matches no `rider_ref` (or the vehicle
  has no `assigned_user_id` and auto-provision is disabled), the function returns
  `401`/`403` and no session — it never falls back to a broad identity.
- **Token scope:** the Bubble Box JWT carries no customer PII — `sub` + standard
  claims + rider marker only.
- **Blast radius of a leaked Bubble Box token** is unchanged from today: one
  driver, one vehicle, GPS writes only. A leaked *minted Supabase session* is the
  same blast radius as today's driver password session.
- **Revocation / offboarding.** Two levers, both server-side: clear the vehicle's
  `rider_ref` (the next exchange finds no mapping → no session), and/or ban/delete
  the mapped Supabase driver user (kills existing sessions and refresh). Losing
  access on Bubble Box's side stops *new* exchanges, but an already-minted Supabase
  session lives until its refresh token expires — so for hard offboarding, ban the
  Supabase user. Document this as the driver-removal runbook.
- **Availability coupling (new, worth stating).** Today, Supabase-authenticated GPS
  survives a Bubble Box outage. After federation, a Bubble Box **auth** outage
  blocks *new* exchanges, so a driver who can't obtain a fresh Bubble Box token
  can't (re)start tracking — though an already-minted Supabase session keeps
  streaming through the outage because Supabase owns its refresh. This is an
  accepted, mild coupling; the once-per-refresh-window exchange keeps the window
  small. Note it in ops.

## Retirements this enables (once proven live)

- `scripts/provision-driver.ts`'s **user-creation step for real drivers** — real
  vans get their driver user auto-provisioned on first federated login (the script
  stays for dev/testing).
- Driver password reset / recovery from the readiness doc's hardening list — moot
  once Bubble Box owns the credential and drivers never hold a Supabase password.

## Open questions (all upstream)

1. **The hinge:** can Bubble Box issue a verifiable JWT (`sub` = rider id, plus a
   discoverable JWKS)? Yes → the Edge Function design. No (opaque tokens only) →
   the function would have to call a Bubble Box introspection endpoint instead of
   verifying locally, keeping the same shape but adding a runtime dependency on
   Bubble Box being up for every exchange — acceptable but weaker.
2. Which **rider identifier** Dmytro puts in `sub`, and that it equals what we
   store in `vehicles.rider_ref` (same open item as the sync).
3. The **rider-vs-customer distinguisher** in the token (dedicated `aud` or a
   `type: "rider"` claim) — required for the trust-scope check.
4. `aud`/`iss` values to agree on, and Bubble Box token **lifetime** (informs how
   often the exchange re-runs, though Supabase owns the long-running session).

## Testing

- **A separate, non-prod Edge Function + its own test secret** — never a
  prod-global auth provider on the shared dev/prod DB. (Auth-provider config is
  project-wide; the shared-DB rule from `HANDOFF.md` means a test issuer registered
  at the project level would be trusted in prod. An Edge Function is per-deployment,
  so a `bubblebox-exchange-test` function with a test keypair leaves prod's exchange
  untouched.)
- A throwaway vehicle with a known `rider_ref`; a hand-signed test JWT (our own test
  keypair standing in for Bubble Box, published as a test JWKS the test function
  reads) to exercise verify → map → mint before Bubble Box is ready.
- Verify end-to-end: a token for rider A mints a session that can read/write only
  A's vehicle; a token for an unmapped `sub` gets no session; a token with the wrong
  `aud` or missing rider marker is rejected before mapping.
- Confirm `POST /api/location` behaves identically to today under the minted
  session (it should — it's an ordinary Supabase driver session).

## Cost / plan footnote

Edge Functions are included in the Supabase plan (invocation-metered on the free
tier, generous limits above it); this exchange is called roughly once per driver
per refresh-window, so volume is trivial. No new plan tier is required, unlike the
Custom OIDC path (which is plan-gated on provider count). Worth a one-line check
against the project's current plan at build time.

---

## 2026-07-22 review — the design against post-M17/M18/M19 reality

**Verdict: the core survives untouched** — verify BB token → map via
`rider_ref` → find-or-auto-provision the driver user → mint a Supabase
session; zero RLS changes; the trust-scope analysis; all three rejected
alternatives stay rejected. What changed is the environment around it.

**Confirmed by M18 (facts, no longer assumptions):**

- Bubble Box signs **RS256 JWTs today** — the fleet token endpoint
  (`POST /api/v2/fleet/authentication-token`) returns one. The hinge question
  ("can they issue a verifiable JWT?") is answered in principle; only the
  public key (or a JWKS URL) is missing on our side.
- The rider identifier is **settled**: `rider.id`, an immutable DB id, stored
  as text in `vehicles.rider_ref` (M18). The sync populates and reads it.
- Their token payload is **Lexik-style, not OIDC-style**: no `sub`, no `iss`,
  no `aud` — payload is `{ iat, exp, admin: { uuid, username, fullName,
  roles[], assignedLaundry, rider } }` (observed on our fleet token, where
  `rider` is null). The spec's `iss`/`aud` claim-pinning maps onto reality as:
  require the rider object (or whatever marks a rider login) and take the
  rider id from it. **Ask Dmytro for one example rider-token payload** — the
  rider marker and id location are the only unknowns left in the contract.
  The ask shrinks accordingly: public key + example payload, probably zero
  new build on his side.

**Drifted — corrections to the text above:**

- **Hosting: not an Edge Function anymore.** Neither stack runs the edge
  runtime (the vendored `supabase-docker/` compose trimmed the service; local
  `config.toml` has `[edge_runtime] enabled = false`), and the boundary the
  Edge Function protected — "service key inside Supabase's environment, never
  on the VPS" — dissolved in M17: the VPS *is* Supabase's environment now
  (`SERVICE_ROLE_KEY` lives in `/opt/fleetmap/supabase-docker/.env`).
  Re-adding a Deno runtime + Kong route for one small function is the wrong
  trade on the 4 GB box. **Build the exchange as a small internal service in
  `docker-compose.prod.yml` following the sync-worker pattern** (same
  TypeScript toolchain, no public port, one Caddy route `/driver-session` →
  the service), holding the service key in its env exactly as the edge
  runtime container would have. Everything in "The exchange" applies
  verbatim; only the box it runs in changes. Shipping this requires amending
  CLAUDE.md's secret-key rule to name this service as the sanctioned holder
  (never the Next app image).
- **The shared dev/prod DB rule is gone** (M17): dev is the local CLI stack,
  prod is self-hosted. The Testing section's "separate test function / never a
  project-level test issuer" caution is moot — test freely against the local
  stack with a hand-signed keypair; prod has its own stack.
- **Policy citations:** 0016 (M19) dropped the driver *stop* policies (0004/
  0005) with the geofence. The driver policies federation cares about are the
  0001 vehicle/position ones (`assigned_user_id = auth.uid()`), which are
  untouched — the "zero RLS changes" property stands, just over a smaller set.
- **Auto-provisioning is now the primary path, not an optimization:** prod has
  **no driver identities at all** (verified + demo data purged 2026-07-22),
  so first federated login creating the driver user is how the real fleet
  gets provisioned — no roster collection, no password distribution to Roman.
  Go-live prep per van collapses to: create the vehicle row + set `rider_ref`.
- **Sequencing opportunity:** Roman has not yet shipped the M17 re-point
  (new Supabase URL + key). If the exchange service exists first, his update
  becomes re-point + call-the-exchange in **one** release, and drivers never
  hold Supabase passwords at any point. Strongly prefer this over two
  releases.

**Revised asks (deferred until Yanis opens the go-live conversation):**
Dmytro — the RS256 public key (or JWKS URL) and one example rider-token
payload; confirmation the rider id in it equals `rider.id` from the routes
API. Roman — nothing until the exchange exists.

---

## Historical 2026-07-27 counter-proposal: introspection, not signature verification

Dmytro opened a three-way chat with Roman and Yanis and proposed a different
verification mechanism. Accepted the same day. **The design below is superseded
at the verification step only; everything downstream is unchanged.**

**What he proposed:**

1. On rider login, Roman's app receives a **dedicated fleet-scoped token** from
   Bubble Box instead of login+password. It encodes the rider id and their
   rights, and is valid for the fleet app only.
2. Roman sends that token to `POST /api/driver-session` as before. We forward
   it to a **new Bubble Box verification endpoint** which checks it against
   their database and its rights, and returns the rider's details (id, name)
   on success or `404` on unknown token / insufficient rights.

**His rationale, assessed honestly:**

- *"No real rider token in the fleet app"* — **correct and the real win.** Our
  design received genuine BB rider tokens. A compromise of this box would have
  handed an attacker credentials that work against Bubble Box itself. A
  fleet-scoped token is useless anywhere else, and he gains immediate
  revocation, which offline signature checking cannot provide at all.
- *"No need to expose the BB public key"* — **not a real security property.**
  Public keys are designed to be published; JWKS endpoints are public URLs and
  nothing can be forged with one. This part of the rationale is mistaken, but
  it costs nothing and the design is good on the first ground alone. Not worth
  contesting; noted here so the reasoning is not inherited as fact.

**Cost accepted:** the exchange now depends on Bubble Box being reachable at
login. A rider cannot start tracking during a BB outage. In practice they
cannot work during one either, and an established Supabase session refreshes
on its own for the rest of the shift, so a mid-shift outage changes nothing.
The larger cost is schedule: this moved Dmytro from "send a file" to "build,
test and deploy an endpoint", which is now the critical path for the login
change. **The order sync is deliberately not coupled to it.**

**What this changes in this repo (pending his endpoint spec):**

- `lib/driver-auth/verify.ts` + `verify.test.ts` — local RS256 verification is
  replaced by an HTTP call. The rider trust boundary moves to his endpoint,
  which checks rights.
- `.env.driver-session` — `BB_DRIVER_JWT_PUBLIC_KEY_B64` gives way to the
  verification endpoint URL + whatever credentials it takes.
- `scripts/gen-driver-test-token.ts` + `.driver-auth-dev/` — obsolete. Local
  testing needs a mock of his endpoint instead.
- `docs/driver-session-api.md` — one change for Roman: *which* token he sends.
  Deliberately not edited yet, so he receives one correction rather than two.

**Unchanged, and already proven in prod on 2026-07-27:** the
`POST /api/driver-session` contract and response shape, the `rider_ref`
lookup, first-login auto-provisioning, the GoTrue session mint, and RLS. The
trust boundary was isolated in a single module precisely so it could be
swapped; this is that swap.

**Answered by Dmytro, 2026-07-27 — both the best case:**

- **Rider id is identical** to the one from `/fleet/rider-routes`. So
  `vehicles.rider_ref` needs no rework and the sync's mapping and the login's
  mapping stay the same value.
- **The endpoint is `/fleet/verify-token`, authenticated exactly like
  `/fleet/rider-routes`**: the token from `/fleet/authentication-token` in the
  header. No new credentials. `workers/bubblebox-sync.ts` already mints that
  token, so the mint belongs in a shared module when driver-session starts
  calling it (do it then, not before — it has no second consumer yet).

**Still open:** the request and response shape (where the rider token sits in
the request, what the success body contains). Asked; not building against a
guess until it lands.

**Dead asks:** the RS256 public key and the rider-token payload sample. Neither
is needed under this design.

### Current addendum — 2026-07-31

The historical unknowns above are resolved:

- After normal rider authentication, the rider app owns a persisted rider
  access token (`loginToken`). It requests a short-lived `fleetAuthToken` from
  `GET /api/v2/riders/fleet-auth-token`, sending that rider token in the
  `accessToken` header, and reads `data.fleetAuthToken`.
- Roman immediately sends that value through the unchanged public Fleetmap
  request `{ "token": "<fleetAuthToken>" }`.
- Fleetmap mints and caches its separate fleet-service `loginToken` from
  `POST /api/v2/fleet/authentication-token`. It sends that server-only value as
  the `accessToken` header to
  `POST /api/v2/fleet/verify-rider-token`, with the public request token
  privately renamed to `{ "riderAuthToken": "<fleetAuthToken>" }`.
- Verification succeeds with top-level `{ "id": integer, "fullName": string }`.
  Fleetmap uses `id` for `vehicles.rider_ref` and discards `fullName`.
- Fleetmap returns Supabase `access_token` and `refresh_token`. The app persists
  them with `setSession`; a cold start restores and refreshes Supabase first.
  After terminal refresh failure, the app uses its still-valid rider
  `loginToken` to acquire a fresh `fleetAuthToken` without interactive login.
  Interactive Bubble Box login is required only when the rider token can no
  longer mint one.

Implementation and deployment state:

- The server-side verification swap, hardened HTTP boundary, safe-stdin
  diagnostic, Compose image tags, and `driver_session` health aggregation are
  complete locally.
- Production has the CORS/liveness image deployed, but not yet the
  verification-swap artifact. *(Superseded: the cutover shipped 2026-08-10 and
  the verification chain was proven live 2026-08-11 — see `docs/HANDOFF.md`.)*
- A real-token proof is blocked by the supplied test fixture, not by code:
  Roman's legacy login path returned `404`, and the documented current login
  returned `401` on 2026-07-31. *(Resolved 2026-08-11: the rider login lives
  under `/shop` — `POST /shop/api/v1/en/security/check-login` — and
  `pnpm mint-fleet-auth-token` self-serves tokens.)*
- The release requires all three explicit `:latest` images built locally and
  the four-variable `.env.driver-session`; the VPS must never build.
- No database migration is required. A valid exchange may auto-provision and
  assign a vehicle, so the proof must use a controlled rider mapping.
