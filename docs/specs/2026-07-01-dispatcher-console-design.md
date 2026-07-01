# Dispatcher console + driver PWA cleanup + landing page

**Status:** design · 2026-07-01 · **Milestone:** M12 (working title)

## Context

Two things changed since M11: (1) the boss confirmed the client (Bubble Box,
`bubblebox.ch`) has no order-export system to integrate against — the
ingestion seam's adapter #2 has nothing to wait on — and (2) the driver-facing
tracking client is now Roman's native Bubblebox app, not fleetmap's web PWA.
Both close out open items from `docs/PRODUCTION-READINESS.md`.

That turns "wire a real adapter" into "build the manual order-entry path we
already designed the ingestion seam to support" (`source: 'manual'` has been
the default since M6). This spec bundles three small, related changes into one
batch:

1. **Dispatcher UI** — the new capability: order intake + basic management.
2. **Driver PWA cleanup** — delete the now-dead reference-only web client.
3. **Landing page** — reintroduce a chooser now that there are two
   authenticated surfaces (`/dashboard`, `/dispatch`) instead of one.

They're bundled because none of them is big enough alone to justify a separate
spec/plan/review cycle, and all three are "things we do now that Roman owns
driver tracking."

## Research: Bubble Box's actual operation (bubblebox.ch)

Checked to ground the order-intake model instead of guessing:

- **Same-address pickup + return.** Laundry is picked up dirty and delivered
  back clean to the same location (home, office, or a locker station).
  Confirms the existing design doc's assumption: *"a return delivery is just a
  `dropoff` stop ingested whenever it's known."* One location per order.
- **Online booking today** — customers pick a date + 30-minute window
  (06:00–22:30) on Bubble Box's own site. That system doesn't feed fleetmap;
  the dispatcher re-enters confirmed orders by hand.
- **Nationwide (schweizweit)** with 3 shops (Rotkreuz, Basel, Binningen),
  3 locker stations, and 5 pickup partners — a materially more complex
  coverage model than fleetmap's current 3-city/one-van-per-area demo data.

**Scope boundary this implies:** shops, locker stations, and pickup partners
are self-service customer channels — no van visits them, so they never become
`stops`. Fleetmap only ever needs to model the van-based home/office leg. The
one real consequence for design: we don't know the real van-to-area coverage
rules, so **the dispatcher picks the van manually** (a plain dropdown) rather
than the system guessing an auto-assignment. That's a decided scope boundary,
not a gap — addable later without a contract change once real coverage rules
exist (the picker would just come pre-filled).

---

## 1. Dispatcher UI

### What it is

A new `/dispatch` page, separate from the TV `/dashboard`. **Order intake and
light management — not route planning.** No drag-and-drop sequencing, no
route drawing, no auto-assignment.

### Auth

A real login form (email + password) against the existing shared `dispatcher`
Supabase Auth identity (`DISPATCHER_EMAIL`/`DISPATCHER_PASSWORD`, already
provisioned by `scripts/provision-dispatcher.ts`) — `supabase.auth.signInWithPassword`
client-side, session persisted (mirrors `lib/supabase/driver.ts`'s
`persistSession: true` pattern, not the dashboard's display-token client).
RLS (`role='dispatcher'`) is the write boundary from there, same as the
existing `POST /api/ingest/routes` / `PATCH /api/stops/:id` handlers already
assume. The existing shared-secret `POST /api/dispatcher-session` endpoint is
untouched — it stays the machine-to-machine path for scripts; the new login
form is the human path onto the *same* Auth identity. Per-dispatcher-person
accounts are a later concern if an audit trail ever matters — YAGNI for now.

### New migration

One additive RLS policy: dispatcher gets `select` on `vehicles` (today only
drivers-own-row (`0001`) and the dashboard role (`0002`) can read it). Needed
to populate the van picker. Mirrors the existing claim-scoped pattern exactly:

```sql
create policy "dispatcher role can read vehicles"
  on vehicles for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');
```

### Screen 1 — intake form

Fields:
- Customer name (text)
- Location — click a point on a map (reuses `FleetMapView` in a click-to-place
  mode) → `lat`/`lng`; address (free-text label, stored on `stops.address`,
  never geocoded)
- Date + optional time window → `orders.scheduled_date` + `stops.eta_at`
  (both columns already exist; `eta_at` is already documented as "optional
  planned window... not computed by us" — exactly this use)
- Van — plain `<select>` of vehicles (from the new RLS-gated read)

Submit → `POST /api/ingest/routes`: one route, `source: 'manual'`,
`external_ref` generated client-side (`crypto.randomUUID()`), one `pickup`
stop, `seq: 1`. Zero changes to the endpoint, validator, or RPC.

### Screen 2 — orders list / manage

- Every open order, grouped by van: customer, address, stop statuses
- **"Add return"** on a pickup that's `completed` → `POST /api/ingest/routes`
  again for the same `external_ref` (upsert), appending a `dropoff` stop at
  the same `lat`/`lng`/`address` already on file — no new location entry
- Cancel/delete an order → `DELETE /api/ingest/routes/:external_ref`
  (existing endpoint)
- Status override / reassign van → `PATCH /api/stops/:id` (existing endpoint)

### Out of scope (YAGNI)

- Route sequencing/reorder UI — `seq` is auto-assigned (append); manual
  resequencing isn't a screen, even though `PATCH /api/stops/:id` supports it
  if ever needed via a future affordance.
- Auto van assignment (see scope boundary above).
- Geocoding / address autocomplete — map-click only. Addable later as a
  drop-in enhancement (an address search box that fills the same pin) without
  touching the ingestion contract.
- Per-dispatcher-person accounts.

### Error handling

No new error taxonomy — surfaces the existing endpoints' status codes
(400/401/404/409) inline on the form/row, matching how the rest of the console
already handles API errors.

### Testing

Vitest for new client-side validation/formatting helpers, mirroring
`lib/ingest-validate.ts`'s existing suite. No e2e suite (project norm) — gate
is `tsc --noEmit` clean + manual acceptance: create an order → see it land on
the TV → add a return → cancel one.

---

## 2. Driver PWA cleanup

Roman's native Bubblebox app now owns real driver tracking. The web driver
PWA (`app/driver`) was already marked reference-only in `CLAUDE.md`; that
reference has served its purpose and can go. Traced the full import graph to
confirm a clean cut — nothing outside this cluster imports any of it:

**Delete:**
- `app/driver/page.tsx`
- `components/driver/driver-app.tsx`
- `lib/supabase/driver.ts`
- `lib/use-location-sync.ts` + `lib/use-location-sync.test.ts`
- `lib/driver-status.ts`
- `lib/use-geolocation.ts`
- `lib/use-wake-lock.ts`

**Keep untouched — backend infrastructure Roman's app actually depends on:**
- `POST /api/location` (`app/api/location/route.ts`) — the real ingest
  endpoint his app posts GPS to
- `lib/geofence.ts` — server-side auto-arrive, runs inside `/api/location`
- Driver RLS policies (`0001_init.sql`, `0005_driver_read_stops.sql`) — the
  security boundary his app authenticates against
- `scripts/provision-driver.ts` — still how real + test driver accounts get
  created (unrelated to the PWA; it's Auth/DB provisioning)
- `docs/driver-app-handoff.md` — his integration reference, not app code

**`CLAUDE.md` updates:** remove the `app/driver/page.tsx` / driver `lib/`
layout rows; change the M3 milestone note from "kept reference-only" to
"removed 2026-07 — Roman's app is live, the web reference is no longer
needed."

---

## 3. Landing page

`app/page.tsx` currently `redirect("/dashboard")` (commit `6eff17b`) —
correct when `/dashboard` was the only destination. With `/dispatch` added,
that's no longer true.

New `app/page.tsx`: a minimal, unauthenticated landing page — two links/cards,
"Dashboard" (TV monitoring) and "Dispatch" (order intake). No auth of its own;
each destination still gates its own access exactly as today (display code /
dispatcher login). Small, on-brand, not a marketing page — a front door.

`app/manifest.ts`'s `start_url: "/dashboard"` stays as-is — that manifest
installs the TV console specifically as a kiosk PWA; unrelated to the
dispatcher surface, no reason to change it.

---

## Sequencing

```
1. Driver PWA cleanup   — pure deletion, zero risk, do first (also shrinks
                           the diff for what follows)
2. Dispatcher UI         — migration + /dispatch route + the two screens
3. Landing page          — trivial once /dispatch exists to link to
```

## Open questions (non-blocking)

1. **Order edit after creation** (beyond status/reassign/cancel) — e.g.
   correcting a mistyped address. Not in scope for V1; `DELETE` + re-create is
   the escape hatch (same as today's script-based re-ingest).
2. **Dispatcher account count** — still just the one shared identity. Revisit
   if more than one person dispatches concurrently and mutation attribution
   starts to matter.

## Risks & mitigations

- **Deleting live-looking driver code that's actually still used somewhere
  unexpected:** mitigated by having traced the full import graph before
  writing this spec (see cleanup section) — the cut is clean.
- **Map-click precision for home addresses:** acceptable for V1 (dispatcher
  can zoom in); geocoding is a drop-in upgrade later if this proves painful in
  practice, not a redesign.

## Constraints honored (the "Don'ts")

No Redis · no bespoke WebSocket · RLS is the boundary (one new claim-scoped
`select` policy, same shape as every existing one) · no broad read-all · OSRM
untouched · no public OSM tiles · stateless API (zero changes to
`POST /api/ingest/routes` / `PATCH /api/stops/:id` / the `ingest_stops` RPC) ·
YAGNI/KISS/DRY (manual van assignment instead of guessed auto-assignment logic;
map-click instead of a new geocoding dependency; one shared dispatcher
identity instead of a new onboarding flow).
