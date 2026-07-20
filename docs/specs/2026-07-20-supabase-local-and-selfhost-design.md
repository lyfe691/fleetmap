# Supabase: local dev stack + VPS self-host

**Status:** approved 2026-07-20 · **Owner:** Yanis · **Depends on:** nothing (deliberately scheduled while the Bubble Box integration is stalled — no live order flow to disturb)

Two staged moves, in order:

1. **Stage 1 — local dev:** development runs against a Supabase stack on the dev machine (Supabase CLI), never against the live project again.
2. **Stage 2 — prod self-host:** the managed cloud project is replaced by the official self-hosted Supabase compose stack on the VPS (`fleet.ysz.life`), fronted by the existing Caddy.

The managed cloud project stays alive and untouched until both stages are proven end-to-end; Yanis pauses/deletes it himself once we're 100% done. Until then it is the rollback path.

## Why

- Dev and prod share one managed project today — flagged as a standing trap in `docs/HANDOFF.md` (fake vans fight real drivers, tests touch the office TV's data).
- The client direction is on-prem anyway (`CLAUDE.md`: "self-hosts as its own compose stack at handoff"); later the stack moves to the company's own server, so getting off managed cloud now is the same work done once, cleanly.
- The Dmytro stall means nothing live changes under us mid-migration.

## Stage 1 — local dev via Supabase CLI

**Install:** `supabase` as a pinned dev dependency (`pnpm add -D supabase --allow-build=supabase`; the `--allow-build` flag is required on pnpm ≥ 10). All commands run project-scoped: `pnpm supabase <cmd>`. Requires Docker Desktop running (already a dev dependency for OSRM).

**Init:** `pnpm supabase init` creates `supabase/config.toml` (committed). The existing `supabase/migrations/*.sql` (0001–0014) are already in the CLI's expected location and lexicographic order — untouched. `project_id = "fleetmap"`.

**Config trim (config.toml):** storage and edge-runtime disabled (nothing uses them; the driver-auth-federation Edge Function enables edge-runtime when it actually lands). Auth, db, realtime, studio stay on defaults.

**Daily loop:**

- `pnpm supabase start` / `stop` — stack up/down (state survives `stop`).
- `pnpm supabase db reset` — drop + re-apply all migrations + `supabase/seed.sql`.
- `supabase/seed.sql` stays minimal (nothing — schema comes from migrations). Identities and demo data keep coming from the existing idempotent scripts: `pnpm provision-dashboard` / `provision-dispatcher` / `provision-driver`, then `pnpm seed-stops` + `pnpm fake-gps`. They already read `.env`, so pointing `.env` at the local stack repoints them for free.

**Env:** `.env` (dev machine) flips to the local stack — `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, publishable + secret keys from the `supabase start` output (`sb_publishable_…` / `sb_secret_…` — same shape our env vars already use). Cloud values live only on the VPS from now on. `.env.example` gets rewritten to describe the local-first workflow.

**Verification (Stage 1 done when):** `pnpm exec tsc --noEmit` + `pnpm test` green; dev server + `fake-gps` move markers on the TV console via local Realtime; History replay works; the M15 fixture E2E (`BB_FIXTURE_FILE=workers/dev-fixture.json pnpm bb-sync`) applies diffs against the local DB.

## Stage 2 — VPS self-host

**Stack shape:** the official `supabase/docker` compose, vendored into the repo at `supabase-docker/` (pinned versions, upstream updates are a diff-and-copy), running as its **own compose project** beside `docker-compose.prod.yml` — matching the CLAUDE.md promise that self-hosting is a deployment change, not an app change.

**Trim:** drop `storage`, `imgproxy`, `functions` (+ their Kong routes); analytics stays off (upstream default). **Studio stays** — it's the only admin UI we'll have; it sits behind Kong's dashboard basic-auth. Note: upstream `kong` has `depends_on: studio (service_healthy)`, so Studio is also structurally cheap to keep and fiddly to remove. Kept services: db (supabase/postgres 17), kong, auth, rest, realtime, meta, studio, supavisor (5432 bound to 127.0.0.1 on the VPS only — never public).

**Keys:** legacy self-host scheme — one generated `JWT_SECRET`, `ANON_KEY`/`SERVICE_ROLE_KEY` derived from it. The app's env names don't change; the anon JWT becomes `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, the service key stays out of the app image as before (it lives only in the supabase stack's own `.env` on the VPS; when an admin script must target prod from the dev machine — e.g. the fake-gps demo — it's passed inline for that run, never stored in the local-first `.env`).

**Edge:** new DNS A record `sb.fleet.ysz.life` → VPS. Caddy (existing container) joins a shared external docker network with Kong and adds one site block: `sb.fleet.ysz.life` → `kong:8000` (websockets proxy transparently; Kong's own ports are not published on the host). `SUPABASE_PUBLIC_URL`/`API_EXTERNAL_URL` = `https://sb.fleet.ysz.life`.

**Migration order (cutover):**

1. Stand up the supabase stack on the VPS; confirm `https://sb.fleet.ysz.life/auth/v1/health`.
2. Apply migrations 0001–0014 via `npx supabase db push --db-url` against the VPS db (127.0.0.1:5432 from the VPS shell) — the repo stays the schema authority; no schema dump from cloud.
3. Copy data from the cloud project: `auth.users` + `auth.identities` (bcrypt hashes survive → every login keeps working: dashboard, dispatcher, riders, test driver) and the public tables (`operational_areas`, `vehicles`, `orders`, `stops`, `vehicle_positions`, `sync_state`). Sessions/refresh tokens are deliberately not copied — every client re-authenticates once.
4. Flip the VPS app `.env` (`NEXT_PUBLIC_SUPABASE_URL` + key) and rebuild the app image (`NEXT_PUBLIC_*` is baked at build time). TV re-enters its display code.
5. Yanis sends Roman the new URL + publishable key (his app re-points; per Yanis this is a small change on his side).
6. Soak. Cloud project stays untouched as instant rollback (flip the VPS `.env` back + rebuild) until Yanis declares done.

**Backups (new responsibility):** self-hosting means we own durability. Nightly `pg_dump` from the db container to `/opt/fleetmap-backups/` (14-day rotation) via cron on the VPS. Offsite copies can come later on the company box.

**Portability:** everything is two compose projects + `.env` files + volumes — moving to the company's Flatcar server later is copy + DNS change, by construction.

## Division of labor

Stage 1: executed directly on the dev machine. Stage 2: every VPS/dashboard step is prepared as paste-ready commands for Yanis (SSH and the Supabase dashboard DB password are his); nothing in Stage 2 is executed without him in the loop.

## Rejected alternatives

- Self-host compose as the local dev environment — loses `db reset`/seed/Studio-per-branch DX; the CLI stack exists for exactly this.
- Merging Supabase services into `docker-compose.prod.yml` — one giant file, painful upstream updates, coupled lifecycles.
- Path-proxying (`fleet.ysz.life/supabase`) instead of a subdomain — Kong path-rewriting breaks websockets/CORS for nothing.
- Full `pg_dump` schema+data restore from cloud — imports cloud-managed cruft and bypasses the migration history; migrations-then-data keeps the repo authoritative.
- New opaque `sb_*` keys on self-host — opt-in and newer surface; legacy JWT keys are the documented default every service in the compose understands. Revisit later if wanted.

## Risks / notes

- **JWT secret changes at cutover** → all existing sessions die once. Expected; TV re-gates, worker re-mints, drivers re-log-in (or Roman's app re-auths silently if it stores credentials).
- **Realtime through Caddy:** plain websocket proxying, no special config; verified in Stage 2 smoke tests (dashboard channel + stops channel).
- **pg_cron (0012)** is included in the `supabase/postgres` image — the retention job survives the move.
- **`vehicle_positions` identity sequence** must be bumped after data copy (`setval`) — covered in the implementation plan.
- **RAM:** per Yanis, not a constraint (bigger company box incoming; trim later if needed).
- Out of scope: Roman's app change (his side), pausing/deleting the cloud project (Yanis, after 100% done), resource tuning.
