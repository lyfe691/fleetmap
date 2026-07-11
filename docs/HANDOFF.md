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
  (Known parked pain point: drivers log in twice — once into the BB app, once
  for our tracking. Untouched, deliberately.)
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

**3. Prove it live, then the retirements** (spec, "Retirements" section):
- **Geofence auto-arrive**: remove the `applyGeofence` call from
  `POST /api/location`, delete `lib/geofence.ts` + its tests + the
  `GEOFENCE_*` env + the driver stop-update RLS policies. BB's statuses are
  authoritative; the radius guess would fight them.
- **`/dispatch`**: delete `app/dispatch`, `components/dispatch/*`,
  `lib/dispatch/*`, `PATCH /api/stops/:id`. It's dormant break-glass today —
  any manual mutation gets overwritten by the next sync tick anyway. The
  dispatcher *identity* + its RLS **stay** (they're the sync's auth).

**4. Independent of all this:** telematics integrate-or-drop decision
(placeholder panels in `lib/console/assumed.ts`).

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
