# Fleetmap handoff — where things stand and what's next

**Updated 2026-09-07.** `CLAUDE.md` is the working brief (stack, layout,
conventions, milestone log). This file is the story around it: the people,
what is agreed and proven, what is deliberately unfinished, and the traps that
bite an unbriefed reader. The chronological investigation log that used to
live here (2026-07-11 → 2026-08-24) is archived verbatim in
`docs/archive/2026-08-24-handoff-history.md`; read it for rationale, not for
status.

## The one-paragraph state

Fleetmap is a live fleet map for Bubble Box (laundry pickup/delivery): the
office TV shows every van moving, with routes, ETAs, and stop status. All of
V1 (M1–M20) is built and running in production on Yanis's VPS
(`fleet.ysz.life`): GPS tracking from Roman's native rider app through the
passwordless driver-session exchange (the §9 production proof passed 2026-08-13,
Roman's device build proven 2026-08-24), the order
sync mirroring Bubble Box's rider routes (live, but against their **staging**
fleet API), the monitoring console, and the self-hosted Supabase stack. What
is left is operational, not code: production Bubble Box credentials, the
production rider-to-vehicle mapping, and the move from the VPS to the
company's server.

## The people (all one company — colleague tone, not vendor/client)

- **Yanis** — owns Fleetmap. Solo project; drafted messages speak as "I".
- **Roman** — built the native rider app. His current build implements the
  driver-session exchange (`docs/driver-session-api.md`) and is proven against
  prod. He owes one more release when the hostnames change (§11 of
  `docs/deployment.md`).
- **Dmytro** — lead developer of the Bubble Box booking backend, the
  integration counterpart for orders and rider-token verification. His fleet
  API and `verify-rider-token` endpoint run on staging
  (`https://upgrade.bubblebox.ch`). **Open with him: when the fleet API runs
  on production, and the production fleet credentials.** Yanis asked in the
  original thread; the answer never came (the conversation moved to the token
  design instead). This is the single blocker for orders go-live.

## What is decided (2026-09-07)

Order of operations: repo cleanup → move to the company server under company
hostnames → go-live there (production credentials, rider mapping, Roman's
release, secret rotation, uptime monitor, offsite backups). Migrate before
go-live because both hostnames are baked into Roman's app and the TV; going
live on `ysz.life` first would cost a second app release and a second driver
cutover. The company server and hostnames are pending from Yanis; the
deployment is hostname-parametrized (`FLEET_HOST`/`SUPABASE_HOST` in `.env`)
so the move is config plus the runbook (the VPS `.env` already carries
`FLEET_HOST`/`SUPABASE_HOST`, added 2026-09-07 ahead of the first redeploy that
needs them).

VPS facts as of 2026-09-07: 1 vCPU, 3.9 GB RAM with the 2 GB swapfile about
half used, 48 GB disk (35% used), both stacks up for 6 weeks, schema at 0016,
pg_cron retention job present. Data is tiny (229 MB database, 0 orders/stops
while staging has no routes, a handful of positions). Auth users: dashboard,
dispatcher, the legacy `driver-roman@fleetmap.app` (M3-era, owns no vehicle,
delete at go-live), and the auto-provisioned `rider-6@driver.fleetmap.internal`.
The nightly backup cron was **not** installed until 2026-09-07 (the only prior
dump was from the 07-20 cutover); it is now, and one fresh dump was taken.
The 2026-08-10 rollback images and the leftover diagnostics upload (that image
has been live since 2026-08-10) were removed from the box the same day.

## The Bubble Box contract, as built

Spec: `docs/specs/2026-07-08-bubblebox-route-sync-design.md` ("Shipped API"
section) + real sample `docs/bubblebox-fleet-routes-example.json`.

- **Auth:** `POST /api/v2/fleet/authentication-token` with
  `BB_API_USERNAME`/`BB_API_PASSWORD` → 24 h token sent as the custom
  `accessToken` header (not `Authorization`). `lib/bubblebox/client.ts`
  mints, caches, and re-mints once on 401.
- **Routes:** `GET /api/v2/fleet/rider-routes` (today by default; `dueDate`
  bounds optional), polled every 60 s. No slim status tier exists; the full
  response is small enough.
- **Semantics:** `vehicles.rider_ref` = `rider.id` as text (a DB id, stable
  forever). A stop is completed iff `actualFulfillmentTime` is set; the
  status enum is the order lifecycle, not stop state. Coordinates arrive as
  strings; null-coordinate points are dropped and reported.
- **Driver login:** the rider app gets a 2-minute `fleetAuthToken` from
  `GET /api/v2/riders/fleet-auth-token` (rider `loginToken` in `accessToken`)
  and posts it to `POST /api/driver-session`. Fleetmap forwards it to
  `POST /api/v2/fleet/verify-rider-token` as `{ riderAuthToken }`,
  authenticated with the same fleet token the sync uses, and reads the
  top-level `id`. Rider login for self-serve testing is
  `POST {BB_API_URL}/shop/api/v1/en/security/check-login` (JSON
  `{username, password}`; the `/shop` prefix is easy to miss);
  `pnpm --silent mint-fleet-auth-token | pnpm verify-live-token` runs the
  whole chain with the staging test rider.

## Invariants and traps (the section to actually memorize)

- **Diff-apply is load-bearing.** The TV's route cache keys on stop
  `id:seq:status`. If `sync_vehicle_routes` ever regresses to
  delete+reinsert, every tick mints new UUIDs → every van refetches OSRM
  every 60 s. Its `is distinct from` guard also keeps no-op ticks free of
  Realtime events. Never "simplify" this.
- **Empty `orders: []` clears a vehicle's synced stops.** That is how days
  roll over and cancellations converge. It looks like data loss; it isn't.
- **Nothing completes stops except the sync.** The geofence and `/dispatch`
  were retired (M19); Bubble Box's statuses are authoritative.
- **The sync stores zero PII** (no address, no customer name;
  `stops.address` was dropped in 0016). Don't add fields back for
  convenience — `stops` rides Realtime unscoped.
- **Dev and prod Supabase are separate** since M17 (local CLI stack vs the
  VPS). Local testing cannot touch prod; prod SQL runs on the box via
  `docker compose ... exec db psql` (no secret leaves it).
- **The secret key never enters the app image.** Its only prod holder is
  `driver-session`, via its own `.env.driver-session`.
- **Never build on the box** (4GB). Images are built locally and shipped as a
  tar; `redeploy.sh` never builds.
- **Untested prod paths fail silently.** Three incidents shared one shape: the
  worker containers never started (`pnpm exec` deps check), Caddy served a
  stale bind-mounted config through a redeploy, and the exchange 405'd
  browser preflights. Each was invisible until something finally used the
  path. Smoke-test every new prod path from outside (`docs/deployment.md` §9).
- **The 2-minute `fleetAuthToken`** must be exchanged immediately after
  Bubble Box login; the Supabase refresh token keeps the session alive
  afterwards. A stored `fleetAuthToken` is always dead.
- **Prod mappings today are the staging test riders** (ids 6 Zurich, 13
  Basel). They must not be carried into production; the go-live checklist in
  `docs/deployment.md` covers clearing them.
- `fake-gps` vans carry no `rider_ref`; the sync ignores them and they render
  beside real vans. Demo tool only.
- `docs/order-ingestion-api.md` is the contract for the manual/dev seam
  (`POST /api/ingest/routes`, used by `seed-stops`), not for Bubble Box.

## Working with Yanis (learned the hard way — saves you a round trip)

- He defers engineering calls but wants a **decisive recommendation**, not an
  options menu. Decide, state why, move.
- He drafts messages to Dmytro/Roman through the agent and sends them
  himself. House style: **no em dashes** (reads as AI to him), plain
  punctuation, short sentences, colleague tone that *asks* rather than
  specifies ("would X be a problem?" not "the response should contain X"),
  no greeting when mid-thread, never make him sound like he's ordering
  teammates around, and always "I", never "we" — Fleetmap is his solo project.
- **Don't push without his say-so** during iterative work; when he says
  "push to be safe," push everything. No Claude co-author trailers.
- Verify with `pnpm exec tsc --noEmit` + `pnpm test` before calling anything
  done; run a real `pnpm build` when the build graph changes (dependency or
  CSS removals — tsc and vitest miss `@import` breakage).
- No explanatory/"gotcha" comments in code — constraints only. Gotchas go in
  chat or in docs like this one.
- He does not have physical access to the office TV; anything TV-side is
  verified in his own browser at `/dashboard`.

## Reading order for a fresh session

1. `CLAUDE.md` — brief, layout, conventions, milestones.
2. This file.
3. `docs/deployment.md` — how prod is run, moved (§11), and taken live.
4. `docs/specs/2026-07-08-bubblebox-route-sync-design.md` — the order sync
   design + upstream contract; `docs/driver-session-api.md` — Roman's
   contract.
