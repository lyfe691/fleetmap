# Route ingestion — full CRUD from the client feed

**Status:** design · 2026-06-29
**Topic:** let the client's dispatch system create / update / delete delivery routes against fleetmap via the existing ingestion seam.

## Goal

The client will push delivery **routes** (a van's ordered tour of stops for a shift) and keep them in sync with **create, update, delete** operations, keyed by *their* route id. We need a clean, idempotent API for that — without destabilising the live dashboard.

## Decision

**A route is modelled as the existing `orders` record + its `stops`. No new tables.**

In fleetmap's M6 model, an `orders` row is already a CRUD-able unit: it has `external_ref` + `unique (source, external_ref)`, a `status`, a `scheduled_date`, and it owns its `stops` via `on delete cascade`. One ingested record = one route; its `stops` are the tour. The word "order" is a slight misnomer for this client, but renaming the table is disruptive (RLS, views, RPC, code) and buys nothing — so we keep the name and document the mapping: **route ⇄ `orders` row identified by `(source, external_ref)`**.

This was chosen over a dedicated `delivery_routes` table because that would put **two** parent links on `stops` (`order_id` + `route_id`) and create a second parallel ingestion path — complexity we'd be paying for an unknown payload format. Per the project's YAGNI/KISS rule, we add that layer only if the client's real feed proves it needs order-within-route nesting (see *Deferred*).

The live read path (`useLiveStops`, `useFleetRoutes`, the console, the driver app, `fake-gps`) reads `stops` by `vehicle_id` and is **completely untouched** by this work.

## What already exists (Create + Update)

`POST /api/ingest/stops` → `ingest_stops(p_orders jsonb)` RPC (migration 0006) already implements create **and** update:

- Upsert each order by `(source, external_ref)` (`on conflict … do update`).
- `delete from stops where order_id = …` then re-insert → **replace-set** the tour.
- Runs as the dispatcher (RLS `role='dispatcher'`); validated by `lib/ingest-validate.ts`.

Re-sending the same route updates it in place. So **create and update need no new code.**

## The gap (Delete)

There is no HTTP route for delete, even though it already works at the DB layer: `stops.order_id` is `on delete cascade`, and the dispatcher RLS policy (`for all`) permits `delete on orders`. Deleting the `orders` row removes its stops; because `stops` is published to Realtime with `replica identity full`, the DELETE payloads carry `vehicle_id`, so the TV evicts those markers automatically.

### New endpoint

`DELETE /api/ingest/stops/[external_ref]?source=<source>`

- **Auth:** Bearer token, runs as dispatcher (same boundary as the POST). `bearerToken` + `createUserClient`.
- **Params:** `external_ref` (path, required, non-empty); `source` (query, optional, defaults to `'manual'` to match the ingest default).
- **Action:** `from("orders").delete().eq("source", source).eq("external_ref", external_ref).select("id")`.
- **Responses:**
  - `200 { ok: true }` — route deleted (stops cascade off the map).
  - `400` — missing/empty `external_ref`.
  - `401` — missing/invalid token.
  - `404 { error: "no such route" }` — no matching `(source, external_ref)` (or RLS hid it).
  - `500` — db error.

New file: `app/api/ingest/stops/[external_ref]/route.ts`. Mirrors the structure of the existing `app/api/stops/[id]/route.ts` (param validate → auth → supabase op → status mapping).

### Delete semantics

**Hard delete (cascade)** is the V1 behaviour — it matches the client's literal "delete", is the simplest correct outcome, and the van's GPS history in `vehicle_positions` is a separate table that is retained regardless. If the client later wants cancelled routes kept for audit, the handler flips to a soft delete (`update orders set status='cancelled'` + delete only the active stops) with no API change. Noted, not built.

## The client's payload → canonical body (adapter seam)

The endpoints accept fleetmap's **canonical** body (`{ orders: [ { source, external_ref, scheduled_date?, customer_name?, stops: [ { seq, stop_type, lat, lng, address?, eta_at?, vehicle_id?, area_id? } ] } ] }`), validated by `lib/ingest-validate.ts`. `vehicle_id` and `area_id` are **UUIDs**.

The client will identify vans and cities by **their own codes**, not our UUIDs. That resolution (`van-code → vehicle_id`, `city → area_id`) and the field mapping from their format live in a thin **adapter** — the same seam as `scripts/adapters/csv-to-stops.example.ts` — which produces the canonical body and calls the endpoints. The core API/DB layer stays UUID-based and unchanged.

**This is the only part that waits on the client.** Everything above can be built and tested now against the canonical contract; the adapter is filled in when we get (1) a sample route payload and (2) how they reference vehicles.

## Out of scope / deferred (YAGNI)

- **No `delivery_routes` table.** Add only if the feed nests multiple distinct customer-orders inside one route, each needing its own identity/PII/status.
- **No `orders.vehicle_id`.** Route→van assignment stays on the stops (as the seed already does); revisit if a route-level reassign becomes common.
- **No `/api/ingest/routes` rename.** Keep the established `/api/ingest/stops` seam; the URL naming is cosmetic and a rename touches every caller for no functional gain.
- **No soft-delete / audit retention** unless requested.

## Testing

- Unit (vitest): extend the `lib/ingest-validate` suite — add validation for the DELETE params (non-empty `external_ref`, optional `source`). The canonical create/update validation already has coverage.
- Manual: `POST` a route → it appears on the TV; re-`POST` with a changed stop → it updates in place; `DELETE` it → its markers disappear. (DB integration isn't unit-tested, consistent with the project.)

## Files touched

- **New:** `app/api/ingest/stops/[external_ref]/route.ts` (DELETE handler).
- **Edit:** `lib/ingest-validate.ts` (+ a small `validateDeleteParams` helper) and its test.
- **Edit (docs):** `CLAUDE.md` layout + the ingestion convention note (CRUD is now complete: create/update via POST, delete via DELETE).
- **Later (blocked on client):** an adapter under `scripts/adapters/` (or a runtime adapter) that maps their format → canonical and resolves van/city codes.

## Open dependency

From the client, eventually: one sample **route payload** and how they **identify vehicles** (their code vs. our UUID). Not blocking — core build proceeds against the canonical contract.
