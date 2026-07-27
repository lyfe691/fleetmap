# What's Missing — from demo to a real, in-use fleet tool

> **Stale snapshot — read `docs/HANDOFF.md` for the current state; it is
> authoritative.** This began as an M12 snapshot (2026-07-01) and is kept for
> its tier/effort framing. Everything after M15 happened elsewhere: the Bubble
> Box API shipped and is wired (M18), `/dispatch` + the geofence were **deleted**
> (M19), Supabase self-hosts on the VPS (M17), and drivers no longer hold
> Fleetmap passwords (M20 token exchange). Any sentence below that treats
> `/dispatch` or the geofence as live is history. Re-verify against `git log`
> before trusting any of it.
>
> Use it as a working checklist. Each item: **what**, **why** (with code/spec
> evidence), a coarse **effort**, and a **first step**. Effort is rough — these
> are scoping estimates, not commitments.

---

## Current state (be honest about real vs. fake)

| Status | Area |
|---|---|
| ✅ **Real & verified** | GPS ingest (`POST /api/location`), Supabase Realtime fan-out, live map + markers, routes + ETA (OSRM proxy), order/stop model with full ingestion CRUD, dispatcher mutations + geofence auto-arrive, multi-city areas, the monitoring console (tracking / map / history / settings, i18n en-de-CH, accessibility), production deployment (Docker + Caddy TLS, live at `fleet.ysz.life`), **the dispatcher console** (`/dispatch` — real login, order intake with map-click location, orders list with add-return/cancel/reassign/status) verified end-to-end against the live Supabase project |
| 🟡 **Placeholder data** | The `Depot` origin label (`ASSUMED_ORIGIN`). The fabricated telematics + cargo/manifest panels were **removed** from the console (2026-07-13); van load is now **derived from real stop data** (completed pickups − deliveries). |
| 🔌 **Built, no dedicated UI** | Real driver onboarding — works via `scripts/provision-driver.ts` (secret key, must be run locally), no admin UI |
| ⏳ **Built, waiting on upstream** | Bubble Box order **sync** (M15) — pull worker + diff-apply RPC, E2E-proven in fixture mode. Live orders flow once Dmytro ships his three endpoints; this is the current gating item (see `docs/HANDOFF.md`). |
| 🚚 **Moved out of scope** | Driver-facing screens — the driver client is now Roman's native Bubblebox app; the web `/driver` route was removed (2026-07, see `docs/specs/2026-07-01-dispatcher-console-design.md`) |

**The one-line read:** the monitoring half is fully live — real-time, routing,
RLS, the order/stop model, deployment, the console. Orders now arrive by
**pull** (M15 Bubble Box sync), built and fixture-proven but waiting on Dmytro's
real endpoints — the one thing gating live order flow.

---

## Tier 1 — Go-live blockers

- [x] **1. App container + HTTPS deployment** — **done.** Live at
  `https://fleet.ysz.life` (`Dockerfile` + `docker-compose.prod.yml` + Caddy,
  `docs/deployment.md`).

- [x] **2. Production OSRM** — **done.** Internal-only in
  `docker-compose.prod.yml`, Switzerland extract persisted in `./osrm`.

- [ ] **3. Real driver + vehicle onboarding**
  - **Why:** `scripts/provision-driver.ts` creates a real driver + vehicle
    (`vehicles.assigned_user_id`, unique) and works today — but it needs the
    dev **secret key** and must be run locally by someone with repo access.
    There's no admin UI or self-serve invite flow.
  - **Effort:** S–M (~1–2d) if an admin UI is wanted; **zero** if the current
    fleet size makes "run the script per new driver" acceptable long-term.
  - **First step:** decide whether fleet size ever justifies a UI, or keep the
    script — it's not blocking anything today.

- [x] **4. Real order / stop ingestion** — **done.** The client (Bubble Box)
  confirmed they have no order-export system to integrate against, so the
  ingestion seam's manual path — always designed to be first-class
  (`source: 'manual'`), never a stopgap — is now the permanent order source,
  fronted by the dispatcher console (item 6, below). `scripts/adapters/csv-to-stops.example.ts`
  stays as a reference stub in case an external feed ever does show up; the
  contract doesn't change if it does.

- [x] **5. Production secrets & config hygiene** — **mechanism done.**
  `.env.example` documents every var; `SUPABASE_SECRET_KEY` is structurally
  kept out of the deployed image. Rotating the *actual* live
  `DISPATCHER_INGEST_SECRET`/`DASHBOARD_DISPLAY_CODE` values is a one-time ops
  task on the VPS `.env`, not a code gap.

---

## Tier 2 — Close the operational loop

- [x] **6. Dispatcher UI** — **done.** `app/dispatch` (`components/dispatch/*`):
  real email/password login against the shared dispatcher identity
  (`lib/supabase/dispatcher.ts`), a new-order form (customer, map-click
  location, van, date/time-window → `POST /api/ingest/routes`), and an orders
  list (add-return, cancel, reassign, status override). New migration `0007`
  (dispatcher can read `vehicles`, needed for the van picker). Verified
  end-to-end against the live project: sign-in → RLS-gated reads → a real
  create/delete round trip through the actual endpoint. See
  `docs/specs/2026-07-01-dispatcher-console-design.md`.

> Dropped from the old doc: "driver stop-list UI" — moot now that the driver
> PWA is retired; that screen belongs to Roman's Bubblebox app, not fleetmap.

---

## Tier 3 — Make it complete

- [x] **7. Route replay → real History** — **done (M14).** The History tab
  replays a vehicle's day from `vehicle_positions` (0008 read path,
  `lib/replay.ts` math, play/pause/scrubber/speed in `history-view.tsx`).

- [~] **8. Telematics + cargo/manifest: integrate or drop** *(product decision, not just code)* — **mostly resolved: dropped.**
  - **Done (2026-07-13):** the fabricated panels (fuel, odometer, cargo temp,
    cargo photos, manifest) were removed from the console rather than faked, and
    van **load is now derived from real stop data**. No fabricated telematics
    remains on the TV; the tracking view was also moved onto the shared `ui/card`.
  - **Done (2026-07-13):** "Distance today" now ships as a server-side aggregate
    (`vehicle_distance_m` RPC, migration `0010`) in the tracking stat row.
  - **Still open:** real weight / temperature / fuel would need in-vehicle
    hardware the fleet doesn't have (and likely won't).

---

## Cross-cutting hardening (do alongside, not blocking)

- [x] **Observability** — **done (2026-07-15).** `GET /api/health` probes
  Supabase + OSRM and reports sync freshness from the `sync_state` heartbeat
  (migration `0013`, written by the worker each tick); the sync worker logs
  structured JSON lines. Remaining ops task: point an external uptime monitor
  at `/api/health` (see `docs/deployment.md`). Also added: nightly
  `vehicle_positions` prune to 30 days (pg_cron, migration `0012`).
- [x] **Dashboard session self-heal** — **done (2026-07-13).** A dead TV session
  (`SIGNED_OUT`) re-mints from the stored display code and remounts the console
  (re-arming Realtime + reloading the snapshot); transient failures back off and
  retry, only a rotated code prompts a human (`components/map/dashboard-gate.tsx`).
- [ ] **Rate-limiting `POST /api/location`** — deliberately deferred (needs
  shared state / Redis, which V1 forbids). Revisit only if abuse is observed.
- [ ] **Driver auth UX** — password reset / account recovery for real drivers.
- [ ] **Dispatcher order editing** — beyond status/reassign/cancel (e.g. a
  mistyped address). `DELETE` + re-create is the current escape hatch.
- [ ] **Multiple dispatcher accounts** — still one shared identity; revisit if
  concurrent dispatchers make mutation attribution matter.

---

## Recommended sequence

```
Blocked on upstream:  Bubble Box sync — wire Dmytro's 3 endpoints when they ship
Optional:             3  (only if driver count outgrows the script)
```

**Monitoring is fully live; route replay (7) and the telematics call (8) are
done.** The remaining gate is live order flow through the M15 sync — see
`docs/HANDOFF.md` for the wire-up steps.

---

## Decisions you need to make

1. **Telematics** — decided (2026-07-13): fabricated panels dropped, load
   derived from real data. Only real hardware (weight/temp/fuel) remains open,
   and the fleet has none.
2. **Driver onboarding** — is `scripts/provision-driver.ts` fine long-term
   given the fleet stays small, or is an admin UI worth building (item 3)?
