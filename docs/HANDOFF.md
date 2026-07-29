# Fleetmap handoff — where things stand and what's next

**Written:** 2026-07-11, by the agent that designed and built M15 (Bubble Box
route sync). Read this before anything else if you're picking the project up —
it's the connective tissue that isn't obvious from the code or the git log.

`CLAUDE.md` is the working brief and stays authoritative for stack/layout/
conventions. This document adds the *story*: who the people are, what was
agreed with them, what was proven, what's deliberately unfinished, and the
traps that will bite an unbriefed reader.

---

## The one-paragraph state

Fleetmap is a live fleet map for Bubble Box (laundry pickup/delivery): office
TV shows every van moving, with routes, ETAs, and stop status. GPS tracking is
live in prod (Roman's native rider app → `POST /api/location`). Orders were
the missing half — and as of M15 they arrive by **pull**: a sync worker
mirrors Bubble Box's rider routes (their route optimizer owns assignment,
stop order, and live status) into our orders/stops. The entire pipeline is
built, unit-tested, and E2E-proven **in fixture mode**. The only missing piece
is wiring the real Bubble Box endpoints, which don't exist yet — Dmytro is
building them.

## The people (all one company — colleague tone, not vendor/client)

- **Yanis** — owns Fleetmap (this repo).
- **Roman** — built the native rider app. Tracking is his and it's done: the
  app authenticates drivers against our Supabase (driver identities like
  `rider_zurichcity1@bb.ch`, one vehicle per driver via
  `vehicles.assigned_user_id`) and streams GPS. Nothing pending with him.
  (Known pain point: drivers log in twice — once into the BB app, once for our
  tracking. Now **designed** in `docs/specs/2026-07-13-driver-auth-federation-design.md`
  (a Supabase Edge Function that exchanges a Bubble Box token for a Supabase
  session), but not built — blocked on whether Bubble Box can issue a verifiable
  JWT. Untouched in code, deliberately.)
- **Dmytro** — lead developer of the Bubble Box booking backend. He is the
  integration counterpart for orders. The full agreement with him is settled
  (see next section); he reacted with a thumbs-up to the final recap and is
  now building. **Messages are up to date as of 2026-07-11 — nothing new is
  pending from our side. The ball is in his court.**

## The agreed upstream contract (settled 2026-07-09)

Dmytro is building a **dedicated Fleetmap API** with three endpoints:

1. **Token endpoint** — app-scoped auth token for us.
2. **Full routes** — all riders' routes for a date (started or not), no
   customer/product/price data. We fetch every **15–30 min**.
3. **Slim statuses** — `orderCode + pickup/delivery + status + fulfilledAt`
   for today. We poll every **60 s**.

Why two tiers: their backend **forbids changing a started route** (morning
locks at start; additions go to the evening route), so structure barely
changes intra-day — but per-stop status (`processing → done`) changes all day
and is what drives the TV (stop fade, next-stop highlight, ETA target).
Dmytro's worry was response size; the split resolved it and he proposed the
final shape himself.

The exact proposed request/response shapes are in the spec
(`docs/specs/2026-07-08-bubblebox-route-sync-design.md`, "Upstream contract")
and typed in `lib/bubblebox/translate.ts` (`BBRoute`, `BBRoutePoint`,
`BBStatusEntry`). His rider-app example response (the semantics source) is
checked in at `docs/bubblebox-rider-route-example.json`.

**Still unknown until he ships** (all folded into the spec's single open
item): final URLs and field names, token endpoint mechanics, the full status
enum (we've only seen `processing`/`done`), and which rider identifier he
picks (that choice defines what `vehicles.rider_ref` holds).

## What was built (M15, commits `1734a3e..bd706b5`)

```
lib/bubblebox/translate.ts       pure translation, the only module that knows
                                 upstream field names (10 unit tests)
supabase/migrations/0009_...     vehicles.rider_ref + sync_vehicle_routes RPC
                                 (diff-apply; APPLIED to the live project)
lib/ingest-validate.ts           + validateVehicleRoutes (6 new tests)
app/api/ingest/vehicle-routes/   PUT — the worker's write path
workers/bubblebox-sync.ts        the worker (fixture mode via BB_FIXTURE_FILE)
workers/dev-fixture.json         dev driving data for the E2E
Dockerfile + docker-compose.prod.yml   `sync` service (internal, no port)
docs/plans/2026-07-09-bubblebox-route-sync.md   the implementation plan
```

⚠️ **The plan's checkboxes were never ticked, but ALL 8 tasks are complete** —
it was executed inline in one session. Do not re-execute the plan.

### What the E2E proved (fixture mode, against the live dev server + real DB)

- Depot points skipped, collective points fanned out to one stop per order,
  `address`/`customer_name` never stored (closes the CLAUDE.md-flagged
  Realtime PII exposure for synced data by construction).
- **Stop ids stay stable across ticks**: a status flip in the source produced
  an in-place UPDATE with identical UUIDs. This is the load-bearing property —
  see Invariants below.
- Removing an order deletes its stops and garbage-collects the order; an
  empty day (`[]`) clears the vehicle. Both are **correct behavior**, not bugs.

To re-run the demo: set `rider_ref` on a throwaway van, then
`BB_FIXTURE_FILE=workers/dev-fixture.json pnpm bb-sync` (dev server running),
edit the fixture and watch stops change within a tick.

## The remaining work, in order

**1. Wire the real API (when Dmytro ships — small session):**
- Fill in `fetchStructure()` / `fetchStatuses()` in `workers/bubblebox-sync.ts`
  (both currently throw "not wired yet" outside fixture mode) + the token
  mint against his auth endpoint.
- Set `BB_API_URL` / `BB_API_CREDENTIALS` (locally first, then in
  `/opt/fleetmap/.env` on the VPS).
- Reconcile his final field names against the types in
  `lib/bubblebox/translate.ts` — that module is the only place upstream names
  live, by design.
- Extend `mapStatus()` once the full status enum is known (today: `done` →
  `completed`, everything else → `planned` — safe but coarse; e.g. a
  "failed/skipped" upstream status currently renders as planned).
- Set `vehicles.rider_ref` for each real van (one `update` per van, identifier
  format depends on what he picked).

**2. Deploy:** `./redeploy.sh` on the VPS. The `sync` service exits on boot
while `BB_*` env is empty — that's expected and fine.
(Migrations `0012` retention + `0013` sync heartbeat must be applied to the
shared Supabase before the worker's heartbeat writes stop warning.)

**3. Prove it live, then the retirements** (spec, "Retirements" section):
- **Geofence auto-arrive**: remove the `applyGeofence` call from
  `POST /api/location`, delete `lib/geofence.ts` + its tests + the
  `GEOFENCE_*` env + the driver stop-update RLS policies. BB's statuses are
  authoritative; the radius guess would fight them.
- **`/dispatch`**: delete `app/dispatch`, `components/dispatch/*`,
  `lib/dispatch/*`, `PATCH /api/stops/:id`. It's dormant break-glass today —
  any manual mutation gets overwritten by the next sync tick anyway. The
  dispatcher *identity* + its RLS **stay** (they're the sync's auth).
  Same migration: **drop `stops.address`** (+ remove it from `ingest_stops`
  and the seed data) — it then has no writer, which structurally closes the
  CLAUDE.md-flagged Realtime PII exposure.

**4. Independent of all this:** telematics integrate-or-drop decision
(placeholder panels in `lib/console/assumed.ts`).
> **Settled, and this item is dead** (2026-07-13, re-verified 2026-07-27):
> dropped. The fabricated panels were deleted rather than faked, load is
> derived from real stop data, distance is a real aggregate (0010). All that
> remains in `assumed.ts` is the `"Depot"` label. Weight/temperature/fuel would
> need hardware the fleet does not have. Do not resurrect this as a task.

## Invariants and traps (the section to actually memorize)

- **Diff-apply is load-bearing.** The TV's route cache keys on stop
  `id:seq:status` (`components/console/console-shell.tsx`, `stopsKey`). If the
  RPC ever regresses to delete+reinsert, every tick mints new UUIDs → every
  van refetches OSRM every 60 s. The RPC's `is distinct from` guard also keeps
  no-op ticks free of Realtime events. Never "simplify" this.
- **Empty `orders: []` clears a vehicle's synced stops.** That's how days roll
  over and how cancellations converge. It looks like data loss; it isn't.
- **The Supabase project is SHARED between dev and prod.** The office TV and
  Roman's app read/write the same DB you test against. Never map a real van
  to test fixtures — create a throwaway vehicle, test, delete it (that's how
  the E2E was done).
- **The secret key never leaves `scripts/`** and never reaches the VPS. The
  worker authenticates via the dispatcher session
  (`POST /api/dispatcher-session`, `x-ingest-secret`) + the publishable key
  for PostgREST reads.
- **The sync stores zero PII on purpose** (no address, no customer name).
  Don't add fields back for convenience — the TV renders neither, and
  `stops` rides Realtime unscoped.
- **String coordinates**: their backend serializes decimals as strings; the
  translator coerces. Keep it that way regardless of what his docs claim.
- **Fixture mode re-reads the file every tick** (deliberate, so edits show up
  immediately); real mode caches structure for `BB_STRUCTURE_INTERVAL_MS`.
- `docs/order-ingestion-api.md` is **superseded for Bubble Box** (push model,
  never used by them) but remains the contract for the manual/dev seam
  (`POST /api/ingest/routes`) that `seed-stops` uses.
- Known accepted risk: a manually-created stop and a synced stop on the same
  vehicle can collide on `seq` (`stops_vehicle_seq_unique`). Irrelevant while
  `/dispatch` is dormant; disappears when it's deleted.
- `fake-gps` writes into the shared DB — a fake van and a real driver fight
  over one marker. Demo tool only.

## Post-handoff additions (2026-07-15)

- **Observability:** `GET /api/health` (Supabase + OSRM reachability + sync
  freshness, informational not gating); the worker logs structured JSON lines
  and upserts a `sync_state` heartbeat after each tick (migration `0013`).
  Point an uptime monitor at `/api/health` once deployed.
- **Retention:** `vehicle_positions` is pruned nightly to 30 days (pg_cron,
  migration `0012`) — it was unbounded before.
- **The stops PII caveat was re-verified:** the old "move address onto
  `orders`" fix in CLAUDE.md was stale and is now corrected — `stops.address`
  simply gets dropped during the `/dispatch` retirement (the sync never writes
  it; only the dormant form and dev seeds do).

## Post-handoff additions (2026-07-22) — the API shipped and is wired

- **Dmytro delivered** the fleet API on staging and it was wired the same
  day. The contract as built is documented in the spec's "Shipped API"
  section (+ real sample: `docs/bubblebox-fleet-routes-example.json`) — it
  superseded parts of "The agreed upstream contract" above: there is **no
  slim status endpoint** (the full endpoint is polled every tick; `isShort`
  is his future idea), auth is a custom `accessToken` header (24 h token
  from `BB_API_USERNAME`/`BB_API_PASSWORD` — `BB_API_CREDENTIALS` and
  `BB_STRUCTURE_INTERVAL_MS` no longer exist), `vehicles.rider_ref` holds
  the **numeric `rider.id` as text**, and stop completion is keyed on
  `actualFulfillmentTime` presence, not the status string (the enum —
  `processing/done/picked_up/ready_for_delivery/loaded_for_delivery` — is
  the order lifecycle projected onto points).
- **E2E-proven against staging** with the local stack: real orders landed on
  a mapped van, stop ids stayed stable across ticks (diff-apply intact),
  old fixture orders were garbage-collected, heartbeat + `/api/health`
  fresh; a year of staging routes through the translator produced 643
  stops with the completed⟺completed_at invariant exact and only the 4
  known null-coordinate points dropped (reported via the `dropped_stops`
  warn log).
- **One trap above is now stale:** since M17 the Supabase project is no
  longer shared — dev runs the local CLI stack, prod self-hosts on the VPS.
  Local testing can't touch prod. (Staging BB creds live in the gitignored
  dev `.env`.)
- **Remaining:** prod rollout (BB env on the VPS, provision the real fleet —
  prod has no real driver identities yet — `rider_ref` per van, ship images),
  prove it live, then merge the retirements.
- **The retirements are done and merged to main** (2026-07-22): `/dispatch` +
  geofence deleted, migration 0016 drops the driver stop policies +
  `stops.address`, console stop labels renamed to `stop.*`/`stopStatus.*`.
  Step 3 above is history — do not re-execute it. Prod still runs the
  pre-retirement image and schema until the next image ship + 0016 `db push`
  (either order is safe; the old code's geofence no-ops against the new
  schema).

## Post-handoff additions (2026-07-27) — prod state, verified by probe

The 07-22 notes were written mid-flight and undersold what actually landed.
Re-probed from outside on 2026-07-27, prod is:

- **Running the M18+M19 build.** `/dispatch` and `PATCH /api/stops/:id` both
  404 — the images built on 07-22 12:37 were shipped after all.
- **At schema 0016.** `select address from stops` returns
  `42703 column does not exist`.
- **Healthy, orders dormant.** `/api/health` →
  `{"ok":true,"supabase":"ok","osrm":"ok","sync":null}` — `sync: null` is the
  worker never having run, which is correct while `BB_*` is unset.
- **Missing only M20.** `POST /api/driver-session` 404s, so the box's git is
  behind commit `113611a` and has neither the compose service nor the Caddy
  route.

Which makes the deploy gap precise, and it is not just "ship an image":

1. The `fleetmap-images.tar.gz` in the repo root is **stale** — built 12:37,
   three and a half hours before the M20 commit. Its index carries
   `fleetmap-app` + `fleetmap-sync` only. The `driver-session` target needs a
   third image (`docs/deployment.md` §7 now builds and saves all three; it
   previously listed two).
2. **`/opt/fleetmap/.env.driver-session` must exist before the redeploy that
   pulls M20.** `env_file` is mandatory in compose — a missing file aborts the
   whole `up`, not just that service. This is the one way the next deploy can
   take prod down, and it is entirely avoidable.
3. The service verifies against whatever key is in that file. A stand-in key
   proves the container boots and the Caddy route resolves; only Dmytro's real
   key makes it usable by drivers. Swapping it later is an env edit plus
   `up -d driver-session` — no rebuild, the key is not a build arg.

### The worker containers never started (found + fixed 2026-07-27)

Smoke-testing the new image before shipping caught a live bug in **both**
worker services. `sync` and `driver-session` ran `CMD ["pnpm", "exec", "tsx", …]`,
and `pnpm exec` re-runs a dependency-status check on every container start.
That check reinstalls — but the worker stages copy only `package.json` +
`tsconfig.json`, not `pnpm-workspace.yaml`, which is where the `allowBuilds`
approvals live. So the install died with `ERR_PNPM_IGNORED_BUILDS` and the
container exited 1 without ever reaching the code.

Both now invoke `./node_modules/.bin/tsx` directly. No package manager in the
runtime path, no deps check, instant boot. Proven: `driver-session` logs its
startup line and answers 401/400/405 correctly; `sync` now reaches its own
"Missing env" guard instead of a pnpm stack trace.

**Why nobody noticed:** the deployed `sync` container is documented as
"exits on boot until `BB_*` is set", so a crash-looping container looked
exactly like expected behavior. It would have surfaced at go-live, the moment
Dmytro's prod credentials went into `.env`, and it would have looked like his
API was the problem. If you are ever debugging a worker that seems to ignore
its env, check that it started at all: `docker compose -f docker-compose.prod.yml logs sync`.

### Caddy served stale config through a redeploy (found + fixed 2026-07-27)

The M20 rollout loaded all three images and started every container cleanly,
and `POST /api/driver-session` still returned Next's 404 page. Two causes
stacked, and the first one masked the second:

1. **`up -d --no-build` does not restart Caddy.** Its container spec was
   unchanged, so compose left it running (`Up 15 hours` next to everything
   else's `Started`). Caddy does not watch its config file, so the new route
   simply did not exist.
2. **The reload did not help either.** `caddy/Caddyfile` was bind-mounted as a
   *single file*, which pins an inode. `git pull` replaces files rather than
   editing in place, so the container's `/etc/caddy/Caddyfile` was still the
   pre-pull content. `caddy reload --config /etc/caddy/Caddyfile` re-read the
   old file and reported success.

Fixed on both levels: `docker-compose.prod.yml` now mounts the *directory*
(`./caddy:/etc/caddy:ro`), so replaced files are visible, and `redeploy.sh`
reloads Caddy after every `up`. Changing the volume spec also makes the next
`up` recreate the container by itself.

Diagnostic if a route ever 404s while its target container is plainly healthy:
`docker compose -f docker-compose.prod.yml exec -T caddy cat /etc/caddy/Caddyfile`.
If that does not match the repo, the mount is stale, not the config.

Note the shape this shares with the `pnpm exec` bug above: both were invisible
because nothing in prod consumed the broken path yet. Assume the same of any
other prod path that has never been exercised.

### Both workers are now proven *in the container*, not just locally

The lesson from the above is that "E2E-proven" had only ever meant `pnpm
<worker>` on a dev machine. Every prior proof ran outside Docker, which is
exactly why a container-only failure survived three milestones. Re-run against
the local Supabase stack on 2026-07-27, from the shipped images:

**driver-session** — all four paths, plus the part that actually matters:
- existing driver user (rider 6) → `200`, session minted
- unassigned van (rider 77) → `200`, `driver_autoprovisioned` then minted
- fleet token (`rider: null`) → `401` "token carries no rider identity"
- rider with no van (99) → `403`
- the returned `access_token` was then used as the Bearer for
  `POST /api/location` → `200 {"ok":true}`. The minted session really does
  satisfy the driver's RLS policies; that chain is no longer inferred.

**sync** — fixture mode wrote 3 stops onto the mapped van (translate → PUT →
`sync_vehicle_routes` → rows, all inside the container). Live mode against
staging logged `mode":"live"` and two clean ticks, and the local heartbeat
went to `fresh: true` with `last_error_at` untouched — so the 24 h token mint
and the HTTPS fetch both work from inside the image, which fixture mode never
exercises. The live tick also cleared the fixture van's stops, since staging
has no route for rider 999: the documented "empty orders clears the vehicle"
invariant, observed rather than assumed.

Containers reach the host stack via
`--add-host host.docker.internal:host-gateway` and
`NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:44321`.

### The worker images went 1.74GB → ~327MB

Both worker stages used to copy the entire `deps` `node_modules` — 1.1GB of
it, including vitest, shadcn, `@react-three` and the whole frontend tree — to
run a few hundred lines of server code. They are now esbuild-bundled to one
self-contained `.mjs` each and run `node` on a bare `node:22-bookworm-slim`
as the non-root `node` user. No pnpm, no `node_modules`, no TypeScript at
runtime, which also makes the `pnpm exec` class of failure structurally
impossible.

`esbuild` is now an explicit devDependency (pinned to `0.28.1`, the version
already in the tree). It was transitive before, so pnpm never linked it into
the root `.bin` and the Docker build could not call it.

Consequences worth knowing:

- The shipped tar went from 374MB to **99MB**.
- The sync image no longer carries `workers/dev-fixture.json`, so
  `BB_FIXTURE_FILE` has nothing to point at in the prod image. To smoke-test
  fixture mode against a built image, bake it into a throwaway layer:
  `FROM fleetmap-sync` + `COPY workers/dev-fixture.json /app/dev-fixture.json`.
- Both slimmed images were re-verified with the full E2E above before shipping,
  not just rebuilt.

### The prod happy path is proven too (2026-07-27)

M20 shipped and the exchange answers on `https://fleet.ysz.life/api/driver-session`
(401 invalid / 400 missing / 405 GET). Beyond the rejection paths, the full
success path was exercised against **prod** using the dev stand-in key, which
prod trusts until Dmytro's key replaces it:

A throwaway `vehicles` row (`rider_ref = '999999'`, no `assigned_user_id`) was
inserted straight on the box, a locally-signed rider token was POSTed to the
public endpoint, and it returned `200` with `access_token` + `refresh_token`.
The DB then showed `assigned_user_id` set, a new
`rider-999999@driver.fleetmap.internal` user, and — after using that
`access_token` as the Bearer for `POST /api/location` — the coordinates on the
vehicle row plus one `vehicle_positions` record. Van, user, and position were
deleted afterwards; prod is back to zero vehicles and the three original
identities.

So Caddy routing, token verification, the `rider_ref` lookup, first-login
auto-provisioning, the GoTrue magiclink mint, and prod RLS are all confirmed
working together.

**The verification step changed the same day.** Dmytro opened a three-way chat
and proposed that Bubble Box issue Roman a fleet-scoped token and expose an
endpoint we call to verify it, rather than us checking a real rider JWT against
their public key. Accepted: it means a compromise here yields tokens useless
outside the fleet app, and he gets revocation. Only `lib/driver-auth/verify.ts`
is affected; everything proven above sits downstream of it and stands. Full
reasoning, including which part of his rationale does not hold up, is in the
spec's 2026-07-27 section. **The public key and rider-sample asks are dead.**

DB access for this used
`docker compose -f supabase-docker/docker-compose.yml exec -T db psql -U postgres -d postgres -c "…"`
on the VPS — no tunnel, and no prod secret leaves the box.

**Everything else is blocked on two messages that were never sent** (deferred
on 07-22, then Yanis was ill for five days): Dmytro owes go-live on the prod
fleet API, and now also the token verification endpoint he proposed on 07-27;
Roman owes one release against `docs/driver-session-api.md`, which carries the
three app constants inline so it stands alone. Those two are separate tracks
on purpose: orders going live does not wait on the login change.

## Post-handoff additions (2026-07-29) — Bubble Box shipped verification, and it 403s

Both counterparties moved on 2026-07-28/29. Neither track is finished, and the
reasons are now precise rather than "waiting".

### The verification endpoint exists, with a different name and a new token

Dmytro shipped it. The contract as he described it, corrected by probing:

- **`POST https://upgrade.bubblebox.ch/api/v2/fleet/verify-rider-token`.** Not
  `/fleet/verify-token` — that name 404s. Update any note that still says it.
- **Header `accessToken`**, the same 24 h fleet token
  `/fleet/authentication-token` mints and the sync already uses. Confirmed:
  sending `Authorization: Bearer` instead fails with
  `401 "Unable to find key \"username\" in the token payload."`.
- **Body `{ "riderAuthToken": "<rider JWT>" }`.**
- The rider app now hands riders a **`fleetAuthToken`** at login, purpose-built
  for us. Same token, two names: Roman's app holds `fleetAuthToken`, we forward
  it as `riderAuthToken`. It is **rider-scoped and cannot log into the rider
  app**, which is the blast-radius improvement the 07-27 redesign was for.
- **It lives 2 minutes.** See the consequences below; this is the detail most
  likely to cause a production surprise.

### It is blocked: our fleet account is not authorized for it

Probed against staging on 2026-07-29 with the credentials in the dev `.env`:

| Request | Result |
|---|---|
| `/fleet/rider-routes`, same token, same moment | `200` with real routes |
| `verify-rider-token`, valid `accessToken`, junk rider token | `403 {"message":"Zugriff verweigert."}` |
| `verify-rider-token`, valid `accessToken`, **no body at all** | `403`, identical |
| `verify-rider-token`, deliberately wrong `accessToken` | `401 "An authentication exception occurred."` |

**Do not stop at that table.** It is consistent with a second, innocent reading:
a controller doing `verify($request->get("riderAuthToken"))` and throwing
`AccessDeniedException` would emit the same `403` for a junk token, a foreign
JWT, and a missing field alike. Under that reading nothing is broken and we
simply never held a valid rider token. Our account being `ROLE_FLEET_OPERATOR`,
a literal match for his "fleet app rights or higher", made that reading more
plausible, not less.

The test that separates them is **malformed JSON**, because security voters run
before body deserialization:

| Request | Result |
|---|---|
| Malformed JSON → `verify-rider-token` (valid `accessToken`) | `403 "Zugriff verweigert."` |
| Malformed JSON → `authentication-token` (no auth, controller runs) | `400 {"data":"","status":"failure"}` |
| `POST` → a nonexistent `/fleet` path | `404` CMS "SEO Redirect not found" |
| `POST` → `/fleet/rider-routes` (GET-only, we are authorized) | `404`, same CMS shape |

Their stack returns `400` when a controller genuinely fails to parse a body. On
`verify-rider-token` broken JSON never gets that far, so the controller does not
run. The two 404 controls show that an unmatched route looks nothing like this,
so the route exists and matches for POST.

One reading still survived that: a **custom voter or authenticator that reads
`riderAuthToken` itself**. That also runs before deserialization and would also
403 every malformed body, and it would mean nothing is wrong on his side. It is
ruled out by timing, with all payloads pre-built and the requests interleaved:

| Body sent to `verify-rider-token` (valid `accessToken`) | Status | min |
|---|---|---|
| malformed JSON, 6 bytes | 403 | 141.7ms |
| valid JSON, token `"x"`, 22 bytes | 403 | 140.9ms |
| valid JSON, junk of JWT size, 557 bytes | 403 | 152.9ms |
| valid JSON, well-formed RS256 JWT, 556 bytes | 403 | 143.5ms |

A well-formed JWT costs the server no more than six bytes of garbage, so no
signature work happens and nothing reads the body. Combined with the 3×3 matrix
below, the denial is on our principal:

| | `rider-routes` | `verify-rider-token` |
|---|---|---|
| valid `accessToken` | **200** | **403** |
| no `accessToken` | 403 | 403 |
| invalid `accessToken` | 401 | 401 |

`403` is simply their anonymous-denied shape (it appears on both routes). What
matters is the top row: same credential, same second, and the only variable is
the route. Our account needs a grant for this endpoint, or we need a different
user, or the endpoint is not enabled for this environment yet. Every surviving
explanation is resolved on his side. **Asked; that is the open item.**

> **Trap, if you re-run this.** The first timing attempt generated a fresh
> RSA-2048 keypair *inside* the timed block, so it measured local CPU and showed
> a fake 136ms gap that argued for exactly the wrong conclusion. Pre-build every
> payload before timing anything against their API.

### That conclusion was WRONG (corrected 2026-07-29, same day)

Dmytro demonstrated the endpoint working from Postman and returning `200`. The
"authorization gap" reading above does not survive it. Keep the section for the
reasoning trail, but **the answer is: we simply never held a valid
`riderAuthToken`**, and a 403 is how the endpoint reports one it cannot verify,
including an expired one.

Where the reasoning broke, because it is worth not repeating:

- **The timing test had no power.** RSA-2048 *verification* costs about 0.1ms.
  The test was built to detect that inside ~140ms of network jitter over 12
  samples. It could never have seen the effect it claimed to rule out. A null
  result from an underpowered test is not evidence of absence.
- **The 400-vs-403 argument assumed shared error handling.** `/fleet/
  authentication-token` returning 400 on malformed JSON says nothing about how
  a *different* controller handles a missing field. One that reads the field,
  fails to verify a null, and throws `AccessDeniedException` produces exactly
  the 403 we saw.
- Every observation collected is fully explained by "the rider token was always
  invalid". None of it ever required an authorization gap.

**Still not strictly proven either way:** his Postman run used *his* accessToken,
not the sync account's. The decisive test is one fresh `riderAuthToken` sent
with **our** accessToken. If that returns 200, the account was never the issue.

### The success shape, which is what we were actually blocked on

```json
{ "id": 6, "fullName": "Rider Zurich City 1" }
```

Top-level `id`, an integer, and `6` is the same rider id `/fleet/rider-routes`
reports for that rider. So `vehicles.rider_ref` is untouched, as he said on
07-27. `fullName` is not stored (the sync stores no PII and this changes
nothing about that).

**Getting a token to test with:** only the rider app issues them, and they live
2 minutes. `scripts/verify-live-token.ts` exists to beat that clock — paste the
token, it runs the BB call and the prod exchange in one shot.

Also still unknown: **what a 200 looks like.** No amount of probing reveals it
while every call 403s, so where the rider id sits in the response is not
established. Do not guess it. Two designs are viable once a real 200 is seen —
read the id from the response body, or read `admin.rider.id` out of the token
we just had verified — and the choice should be made against a real payload,
not a plausible one.

### The 2-minute lifetime changes the client contract

`docs/driver-session-api.md:33-39` is now wrong and must be corrected when the
swap lands. It tells Roman that BB tokens live 24 h and to re-exchange whenever
Supabase refresh ultimately fails. With a 2-minute token he will not have a
live one weeks later. The real shape:

- Exchange **immediately** after the BB login, not lazily when tracking starts.
- Keep the Supabase session alive by refresh; never re-exchange with the old
  `fleetAuthToken`.
- If refresh ultimately fails, the driver needs a **new BB login** — unless the
  rider app can mint a fresh `fleetAuthToken` on demand, which is asked and
  unanswered.

### CORS was ours, and it was blocking Roman

He reported a CORS error calling `/api/driver-session` from the rider app.
Reproduced against prod: `OPTIONS` hit the blanket `405 {"error":"POST only"}`
with no CORS headers, so the browser blocked the call before the POST was sent.
The `401` carried no headers either, so even past preflight he could not read
the status.

Fixed in `workers/driver-session.ts` (cbbd790), **deployed and verified in prod
on 2026-07-29**: `OPTIONS` 405 → **204** with all four headers, a rejected
`POST` still 401 but now carrying them, `GET` → `200 {"ok":true}`,
`/api/health` still `{"ok":true,"supabase":"ok","osrm":"ok","sync":null}`, and
the dashboard unaffected. The change is `OPTIONS` → 204, `GET` → a liveness
200, and `CORS_HEADERS` on **every** response including rejections.
Origin is `*` deliberately — the credential is in the request body, never a
cookie, so there is no ambient authority for a hostile origin to ride on, and
an allowlist would break his local development for no real gain. Only
`Content-Type` is allowed; if his client ever sends another header it needs
adding.

**Note the trap this shares with the two in the 07-27 section:** the endpoint's
browser path had never been exercised, so nothing revealed that a preflight
would 405. Same shape as the `pnpm exec` and stale-Caddy bugs — untested prod
paths fail silently until someone finally uses them.

### Where that leaves the two tracks

- **Login:** blocked on Dmytro granting our account access to
  `verify-rider-token` and describing a success response. Everything downstream
  of `lib/driver-auth/verify.ts` is built, tested and deployed. Roman must not
  ship until the swap is live — until then the service verifies RS256 against
  the dev stand-in key and will 401 every real `fleetAuthToken`.
- **Orders:** unchanged and still first in line. Prod BB credentials plus one
  `vehicles` row per rider, then watch `/api/health`.

## Working with Yanis (learned the hard way — saves you a round trip)

- He defers engineering calls but wants a **decisive recommendation**, not an
  options menu. Decide, state why, move.
- He drafts messages to Dmytro/Roman through the agent and sends them
  himself. House style: **no em dashes** (reads as AI to him), plain
  punctuation, short sentences, colleague tone that *asks* rather than
  specifies ("would X be a problem?" not "the response should contain X"),
  no greeting when mid-thread, and never make him sound like he's ordering
  teammates around.
- **Don't push without his say-so** during iterative work; when he says
  "push to be safe," push everything.
- Verify with `pnpm exec tsc --noEmit` + `pnpm test` before calling anything
  done; run a real `pnpm build` when the build graph changes.
- No explanatory/"gotcha" comments in code — constraints only. Gotchas go in
  chat (or in docs like this one).
- There's also a persistent agent memory directory for this project
  (`~/.claude/projects/C--Users-YanisSebastianZ-rche-Desktop-coding-fleetmap/memory/`)
  with the same context in condensed form.

## Reading order for a fresh session

1. `CLAUDE.md` — brief, layout, conventions, milestones.
2. This file.
3. `docs/specs/2026-07-08-bubblebox-route-sync-design.md` — the M15 design +
   upstream contract + retirement plan.
4. When wiring the real API: `lib/bubblebox/translate.ts` (types + tests) and
   `workers/bubblebox-sync.ts` (the two marked stubs).
