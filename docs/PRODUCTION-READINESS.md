# What's Missing — from demo to a real, in-use fleet tool

> Snapshot as of `6eff17b` (2026-07-01). Supersedes the `a6f303c` (2026-06-23)
> snapshot, which predated the Dockerfile/prod deploy, the route-ingestion CRUD
> rename, the driver PWA retirement, and the console redesign — several of its
> "not built" items are done now. Re-verify against `git log` before trusting
> this doc again; it goes stale fast.
>
> Use it as a working checklist. Each item: **what**, **why** (with code/spec
> evidence), a coarse **effort**, and a **first step**. Effort is rough — these
> are scoping estimates, not commitments.

---

## Current state (be honest about real vs. fake)

| Status | Area |
|---|---|
| ✅ **Real & verified** | GPS ingest (`POST /api/location`), Supabase Realtime fan-out, live map + markers, routes + ETA (OSRM proxy), order/stop model with full ingestion CRUD (`POST`/`DELETE /api/ingest/routes`), dispatcher mutations + geofence auto-arrive (`PATCH /api/stops/[id]`), multi-city areas, the monitoring console (tracking / map / history / settings, i18n en-de-CH, accessibility), production deployment (Docker + Caddy TLS, live at `fleet.ysz.life`) |
| 🟡 **Placeholder data** | Telematics (fuel, odometer, cargo temp), cargo/manifest, **the entire History tab** — all from `lib/console/assumed.ts`, clearly marked in-UI |
| 🔌 **Built, but no UI** | Dispatcher mutations (`PATCH /api/stops/[id]`, `POST /api/ingest/routes`) — reachable only via API + dev scripts, no screen; real driver onboarding — works via `scripts/provision-driver.ts` (secret key, must be run locally), no admin UI |
| ❌ **Not built / blocked** | A real order source wired to the ingestion seam (**blocked on the client**, not on us — see "Decisions you need to make"); a dispatcher UI; route replay; telematics integration |
| 🚚 **Moved out of scope** | Driver-facing screens — the driver client is now Roman's native Bubblebox app; the web `/driver` route + `components/driver/*` stay as reference-only |

**The one-line read:** real-time, routing, the RLS security model, the order/stop
data model, and deployment are all done. What's left is a **dispatcher-facing
UI** and the pieces that depend on data we don't have yet (client's real order
feed, telematics hardware).

---

## Tier 1 — Go-live blockers

- [x] **1. App container + HTTPS deployment** — **done.** `Dockerfile` (multi-stage
  standalone Next build) + `docker-compose.prod.yml` (Caddy → app → OSRM) +
  `caddy/Caddyfile`, documented end-to-end in `docs/deployment.md`. Live at
  `https://fleet.ysz.life`.

- [x] **2. Production OSRM** — **done.** Runs internal-only in
  `docker-compose.prod.yml`; the Switzerland extract is built once per
  `docs/deployment.md` §3 and persists across redeploys in `./osrm`.

- [ ] **3. Real driver + vehicle onboarding**
  - **Why:** `scripts/provision-driver.ts` creates a real driver + vehicle
    (`vehicles.assigned_user_id`, unique) and works today — but it needs the
    dev **secret key** and must be run locally by someone with repo access.
    There's no admin UI or self-serve invite flow.
  - **Effort:** S–M (~1–2d) if an admin UI is wanted; **zero** if the current
    fleet size makes "run the script per new driver" acceptable long-term.
  - **First step:** decide whether fleet size ever justifies a UI, or keep the
    script — it's not blocking anything today.

- [ ] **4. Real order / stop ingestion**
  - **Why:** the ingestion seam itself is **complete and tested** —
    `POST /api/ingest/routes` (create/update, idempotent upsert by
    `(source, external_ref)`), `DELETE /api/ingest/routes/:external_ref`, RLS,
    Realtime, the TV's live consumption — all shipped, `tsc`/`vitest` clean, no
    ingestion-touching commits since the CRUD rename (`41a721b`, 2026-06-29).
    The only unbuilt piece is **adapter #2**
    (`scripts/adapters/csv-to-stops.example.ts`), an explicit stub because the
    client's real export format is still unknown.
  - **Effort:** S–M (~1–3d), and only once the format is known — the API/DB
    layer doesn't change.
  - **First step:** get the answer from the client (see "Decisions you need to
    make" #1 below); if the answer is "there is no real export," see #2.

- [x] **5. Production secrets & config hygiene** — **mechanism done.**
  `.env.example` documents every var (`DASHBOARD_*`, `DISPATCHER_*`,
  `GEOFENCE_*`, `OSRM_URL`, etc.); `SUPABASE_SECRET_KEY` is structurally kept
  out of the deployed image (never referenced in `Dockerfile`/`docker-compose.prod.yml`,
  scripts-only by design). Rotating the *actual* live values for
  `DISPATCHER_INGEST_SECRET`/`DASHBOARD_DISPLAY_CODE` from their dev-generated
  originals is a one-time ops task on the VPS `.env`, not a code gap.

---

## Tier 2 — Close the operational loop (backend exists, UI doesn't)

- [ ] **6. Dispatcher UI** *(highest-value functional gap)*
  - **Why:** `PATCH /api/stops/[id]` (reassign / reorder / cancel / set-status)
    and `POST /api/ingest/routes` (create/update a route) both exist, are
    dispatcher-authed, and are fully tested — but **nothing in
    `components/console` calls either**. No one can dispatch or manually key in
    a route from a screen; the console today is monitoring-only.
  - **Effort:** M (~2–3d).
  - **First step:** a dispatcher view (separate from the read-only TV console)
    to create/assign/reorder stops per vehicle, backed by the existing
    endpoints and dispatcher identity. **This is also the answer if the client
    turns out to have no real order-export system** — `POST /api/ingest/routes`
    already treats `source: 'manual'` as first-class, so this UI becomes the
    permanent order-entry path, not a stopgap.

> Dropped from the old doc: "driver stop-list UI" — moot now that the driver
> PWA is retired; that screen belongs to Roman's Bubblebox app, not fleetmap.

---

## Tier 3 — Make it complete

- [ ] **7. Route replay → real History**
  - **Why:** the History tab is 100% placeholder (`assumedHistory()` in
    `components/console/history-view.tsx`), but `vehicle_positions` is an
    append-only history table built **for exactly this**. Replace the fake tab
    with real trip playback.
  - **Effort:** M (~2–3d).

- [ ] **8. Telematics + cargo/manifest: integrate or drop** *(product decision, not just code)*
  - **Why:** fuel / odometer / cargo temperature / manifest are placeholders
    (`lib/console/assumed.ts`) that need real hardware/telematics or real order
    line-items to be true. Decide whether to integrate a feed or remove those
    panels so the UI never implies data it doesn't have.
  - **Effort:** decision first; integration is L and vendor-dependent.

> Dropped from the old doc: "orders/deliveries model" as a separate item — M6–M9
> already shipped it in full (`orders`/`stops` schema, status lifecycle,
> geofence auto-arrive, dispatcher mutations). What's left of that ambition is
> exactly items 6–8 above.

---

## Cross-cutting hardening (do alongside, not blocking)

- [ ] **Observability** — structured logs, error tracking, and an uptime/health
  check on the API + OSRM (none today).
- [ ] **Dashboard session self-heal** — a dead TV session surfaces as a banner;
  the deferred follow-up is auto re-minting from the stored display code so an
  unattended TV recovers without a human reload.
- [ ] **Rate-limiting `POST /api/location`** — deliberately deferred (needs
  shared state / Redis, which V1 forbids). Revisit only if abuse is observed.
- [ ] **Driver auth UX** — password reset / account recovery for real drivers.

---

## Recommended sequence

```
Operate:     6           (dispatcher UI — unlocks manual entry regardless of
                           whether the client has a real feed)
Go real:     4            (real order source, once the client answers #1 below)
             3            (only if driver count outgrows the script)
Complete:    7 → 8        (real history, telematics call)
```

**Minimum to be fully "real":** item 6 (dispatcher UI) is the actual remaining
blocker — everything upstream of it (deploy, data model, ingestion seam,
security) is already live.

---

## Decisions you need to make

1. **Where orders come from** — the question to put to the client/boss: *"How
   do you currently track and dispatch today's delivery routes — is there a
   system (WMS, ERP, route-planning software) that can export or push that
   data (CSV, webhook, API), or is it manual (spreadsheet, paper, phone)? And
   how do you refer to your vans — plate, an internal code, something else —
   so we can map their data onto ours?"* This drives item 4's adapter and
   nothing else changes based on the answer.
2. **If there's no real export system:** don't wait on item 4 — build the
   dispatcher UI (item 6) as the permanent order-entry path. The ingestion
   contract already defaults `source` to `'manual'`, so "a dispatcher types in
   the day's routes" isn't a workaround, it's a first-class supported source.
3. **Telematics** — integrate real hardware, or drop those panels (item 8).
4. **Driver onboarding** — is `scripts/provision-driver.ts` fine long-term
   given the fleet stays small, or is an admin UI worth building (item 3)?
