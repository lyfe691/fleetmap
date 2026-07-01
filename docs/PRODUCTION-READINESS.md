# What's Missing — from demo to a real, in-use fleet tool

> Snapshot as of M12 (2026-07-01, commit range `8f3b661`..`HEAD`). Supersedes
> the `6eff17b` (2026-07-01, pre-M12) snapshot — the dispatcher UI and the
> driver PWA cleanup that snapshot listed as gaps are now done. Re-verify
> against `git log` before trusting this doc again; it goes stale fast.
>
> Use it as a working checklist. Each item: **what**, **why** (with code/spec
> evidence), a coarse **effort**, and a **first step**. Effort is rough — these
> are scoping estimates, not commitments.

---

## Current state (be honest about real vs. fake)

| Status | Area |
|---|---|
| ✅ **Real & verified** | GPS ingest (`POST /api/location`), Supabase Realtime fan-out, live map + markers, routes + ETA (OSRM proxy), order/stop model with full ingestion CRUD, dispatcher mutations + geofence auto-arrive, multi-city areas, the monitoring console (tracking / map / history / settings, i18n en-de-CH, accessibility), production deployment (Docker + Caddy TLS, live at `fleet.ysz.life`), **the dispatcher console** (`/dispatch` — real login, order intake with map-click location, orders list with add-return/cancel/reassign/status) verified end-to-end against the live Supabase project |
| 🟡 **Placeholder data** | Telematics (fuel, odometer, cargo temp), cargo/manifest, **the entire History tab** — all from `lib/console/assumed.ts`, clearly marked in-UI |
| 🔌 **Built, no dedicated UI** | Real driver onboarding — works via `scripts/provision-driver.ts` (secret key, must be run locally), no admin UI |
| ❌ **Not built** | Route replay (real History); telematics integration |
| 🚚 **Moved out of scope** | Driver-facing screens — the driver client is now Roman's native Bubblebox app; the web `/driver` route was removed (2026-07, see `docs/specs/2026-07-01-dispatcher-console-design.md`) |

**The one-line read:** everything required to run and monitor real deliveries
is done — real-time, routing, the RLS security model, the order/stop data
model, deployment, and now order intake itself. What's left (items 7–8 below)
is polish, not a blocker.

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
- [ ] **Dispatcher order editing** — beyond status/reassign/cancel (e.g. a
  mistyped address). `DELETE` + re-create is the current escape hatch.
- [ ] **Multiple dispatcher accounts** — still one shared identity; revisit if
  concurrent dispatchers make mutation attribution matter.

---

## Recommended sequence

```
Complete:    7 → 8        (real history, telematics call)
Optional:    3             (only if driver count outgrows the script)
```

**Everything required to run and monitor real deliveries is live.** What's
left is history/telematics polish and, if fleet size ever demands it, a driver
onboarding UI.

---

## Decisions you need to make

1. **Telematics** — integrate real hardware, or drop those panels (item 8).
2. **Driver onboarding** — is `scripts/provision-driver.ts` fine long-term
   given the fleet stays small, or is an admin UI worth building (item 3)?
3. **Route replay priority** — worth building now (item 7), or is the History
   tab's placeholder acceptable for longer?
