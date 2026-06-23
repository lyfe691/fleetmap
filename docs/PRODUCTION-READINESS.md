# What's Missing — from demo to a real, in-use fleet tool

> Snapshot as of `a6f303c` (2026-06-23). The real-time pipe is built and
> runtime-verified; this doc is the gap between "demo running on `fake-gps` +
> placeholder panels" and "real drivers, real orders, in daily use."
>
> Use it as a working checklist. Each item: **what**, **why** (with code/spec
> evidence), a coarse **effort**, and a **first step**. Effort is rough — these
> are scoping estimates, not commitments.

---

## Current state (be honest about real vs. fake)

| Status | Area |
|---|---|
| ✅ **Real & verified** | GPS ingest (`POST /api/location`), Supabase Realtime fan-out, live map + markers, routes + ETA (OSRM proxy), stop lifecycle + geofence auto-arrive, multi-city areas, the monitoring console (tracking / map / history shells) |
| 🟡 **Placeholder data** | Telematics (fuel, odometer, cargo temp), cargo/manifest, **the entire History tab** — all from `lib/console/assumed.ts`, clearly marked in-UI |
| 🔌 **Built, but no UI** | Dispatcher mutations (`PATCH /api/stops/[id]` — reassign/reorder/cancel/status); the driver's own stop list (`0005` RLS already permits it) |
| ❌ **Not built** | App container / deployment, real driver+vehicle onboarding, a real order source, the orders/deliveries model, route replay |

**The one-line read:** the hard part (real-time, routing, RLS security model) is
done. What's left is the *operations layer* and *getting it deployed*.

---

## Tier 1 — Go-live blockers (required to replace `fake-gps` with real phones)

- [ ] **1. App container + HTTPS deployment**
  - **Why:** there is **no `Dockerfile`** — `docker-compose.yml` only runs the
    OSRM container. The spec assumes "the Next.js app in one container"
    (`docs/specs/live-tracking-spec.md:99`) but it doesn't exist yet. The driver
    PWA uses `watchPosition` + Screen Wake Lock, both of which **require HTTPS** —
    so no real phone can stream until this is hosted behind TLS.
  - **Effort:** S–M (~1–2d).
  - **First step:** write a multi-stage `Dockerfile` for the Next.js app; pick a
    host that terminates TLS (managed platform or a reverse proxy); add the app
    as a service in compose alongside OSRM.

- [ ] **2. Production OSRM**
  - **Why:** the OSRM container is a dev setup pinned to a Switzerland extract
    (`docker-compose.yml`). For production it needs to run reliably next to the
    app (the spec: OSRM stays internal, only `/api/route` talks to it) with the
    right regional extract and a rebuild path when the map data updates.
  - **Effort:** S (~0.5–1d).
  - **First step:** bake the extract build into the compose/deploy flow; set
    `OSRM_URL` to the internal service name in the deployed env.

- [ ] **3. Real driver + vehicle onboarding**
  - **Why:** today `scripts/fake-gps.ts` self-creates a driver + vehicle per city
    using the **dev-only secret key**. Real drivers need real Auth accounts, each
    mapped to exactly one vehicle (`vehicles.assigned_user_id`, unique). There is
    no signup/invite/admin flow — only dev provisioning scripts.
  - **Effort:** M (~2–3d).
  - **First step:** decide the model (admin-invites-driver vs. self-signup +
    approval); build a minimal "create driver → create vehicle → assign" path
    that runs server-side without shipping the secret key.

- [ ] **4. Real order / stop ingestion**
  - **Why:** `scripts/seed-stops.ts` is dev-only, and the second ingestion
    adapter (`scripts/adapters/csv-to-stops.example.ts`) is an explicit **stub**.
    The seam is real (`POST /api/ingest/stops`, dispatcher identity, RLS) but
    nothing real feeds it — so there are no real routes without this.
  - **Effort:** S–M (~1–3d, depends on the source system).
  - **First step:** identify where orders come from (a WMS/order system, a CSV
    export, manual entry); wire one real adapter onto the existing ingest seam.

- [ ] **5. Production secrets & config hygiene**
  - **Why:** during setup, `DISPATCHER_INGEST_SECRET` and `DISPATCHER_PASSWORD`
    were blank and filled with **generated dev values**; the dashboard/dispatcher
    are provisioned by dev scripts. Production needs real, rotated secrets, a
    managed env, and the secret key kept strictly out of any deployed image
    (it's `scripts/`-only by design).
  - **Effort:** S (~0.5d).
  - **First step:** move secrets into the host's secret manager; rotate the
    dev-generated `DISPATCHER_*` values; confirm no `SUPABASE_SECRET_KEY` path
    reaches the app build.

---

## Tier 2 — Close the operational loop (backend exists, UI doesn't)

- [ ] **6. Driver stop-list UI** *(highest-value functional gap)*
  - **Why:** a driver running the PWA today sees only an ON/OFF toggle + status
    (`components/driver/driver-app.tsx`). They **cannot see where they're going**.
    The data and RLS already exist (`0005` lets a driver read their own stops) —
    this is purely a missing screen, and it's what makes the PWA usable for a
    real delivery run.
  - **Effort:** S–M (~1–2d).
  - **First step:** add a stops list to the driver app (next stop, ETA, address,
    sequence) reading the driver's own stops; mark arrived/done as they progress.

- [ ] **7. Dispatcher UI**
  - **Why:** `PATCH /api/stops/[id]` supports reassign / reorder / cancel /
    set-status, with **no UI consuming it**. So no one can actually *dispatch* —
    the console is monitoring-only. This is the other half of "operate the fleet."
  - **Effort:** M (~2–3d).
  - **First step:** a dispatcher view (separate from the read-only TV console)
    to assign/reorder stops per vehicle, backed by the existing PATCH endpoint
    and dispatcher identity.

---

## Tier 3 — Make it complete (the spec's stated "Later")

> `docs/specs/live-tracking-spec.md:109` — *"orders/deliveries model,
> auto-assigned dropoffs + per-delivery status, route replay from
> `vehicle_positions`."*

- [ ] **8. Orders / deliveries model**
  - **Why:** replaces the assumed cargo/manifest and unlocks per-delivery status.
    It's the foundation the placeholder panels are waiting on
    (`lib/console/assumed.ts`, the in-UI "pending the orders/deliveries model"
    notes).
  - **Effort:** L (~3–5d, design-first).

- [ ] **9. Route replay → real History**
  - **Why:** the History tab is 100% placeholder (`assumedHistory()`), but
    `vehicle_positions` is an append-only history table built **for exactly this**
    (spec: "replay + audit later"). Replace the fake tab with real trip playback.
  - **Effort:** M (~2–3d).

- [ ] **10. Telematics: integrate or drop** *(product decision, not just code)*
  - **Why:** fuel / odometer / cargo temperature are placeholders that need real
    hardware/telematics to be true. Decide whether to integrate a feed or remove
    those panels so the UI never implies data it doesn't have.
  - **Effort:** decision first; integration is L and vendor-dependent.

---

## Cross-cutting hardening (do alongside, not blocking)

- [ ] **Observability** — structured logs, error tracking, and an uptime/health
  check on the API + OSRM (none today).
- [ ] **Dashboard session self-heal** — plan 017 surfaces a dead TV session as a
  banner; the deferred follow-up is auto re-minting from the stored display code
  so an unattended TV recovers without a human reload.
- [ ] **Rate-limiting `POST /api/location`** — deliberately deferred (needs shared
  state / Redis, which V1 forbids). Revisit only if abuse is observed.
- [ ] **Driver auth UX** — password reset / account recovery for real drivers.

---

## Recommended sequence

```
Go real:     1 → 2 → 5  (deploy on HTTPS with prod OSRM + real secrets)
             3, 4        (real drivers + real orders flowing in)
Operate:     6 → 7       (driver sees route; dispatcher can dispatch)
Complete:    8 → 9 → 10  (orders model, real history, telematics call)
```

**Minimum to run a real delivery on a real phone:** Tier 1 (1–5) + item 6
(driver stop-list). Everything else makes it *complete*; that subset makes it
*real*.

---

## Decisions you need to make

1. **Deployment target** — managed platform vs. self-hosted compose (the spec
   keeps both open; this picks the path for items 1–2).
2. **Where orders come from** — drives item 4's adapter.
3. **Telematics** — integrate real hardware, or drop those panels (item 10).
4. **Driver onboarding model** — admin-invite vs. self-signup (item 3).
