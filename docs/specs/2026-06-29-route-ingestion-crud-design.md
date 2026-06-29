# Route ingestion — full CRUD from the client feed

**Status:** design · 2026-06-29
**Topic:** let the client's dispatch system create / update / delete delivery routes against fleetmap via a dedicated ingestion endpoint.

## Goal

The client will push delivery **routes** (a van's ordered tour of stops for a shift) and keep them in sync with **create, update, delete** operations, keyed by *their* route id. We need a clean, idempotent, self-describing API for that — the way the driver's phone pushes GPS to `POST /api/location` — without destabilising the live dashboard.

## Decision

**A route is modelled as the existing `orders` record + its `stops`. No new tables.**

In fleetmap's M6 model, an `orders` row is already a CRUD-able unit: it has `external_ref` + `unique (source, external_ref)`, a `status`, a `scheduled_date`, and it owns its `stops` via `on delete cascade`. One ingested record = one route; its `stops` are the tour. The word "order" is a slight misnomer for this client, but the table name stays internal — the **external API speaks "routes"** (see *API*). Mapping: **route ⇄ `orders` row identified by `(source, external_ref)`**.

This was chosen over a dedicated `delivery_routes` table because that would put **two** parent links on `stops` (`order_id` + `route_id`) and create a second parallel ingestion path — complexity we'd be paying for an unknown payload format. Per YAGNI/KISS, we add that layer only if the client's real feed proves it needs order-within-route nesting (see *Deferred*).

The live read path (`useLiveStops`, `useFleetRoutes`, the console, the driver app, `fake-gps`) reads `stops` by `vehicle_id` and is **completely untouched** by this work.

## API — a dedicated `/api/ingest/routes` endpoint

The client integrates against one place, exactly like the phone → `/api/location`. Same dispatcher-auth boundary as the existing ingest (Bearer token, runs as `role='dispatcher'`).

| Op | Endpoint | Body |
|---|---|---|
| Create / Update | `POST /api/ingest/routes` | `{ routes: [ { source?, external_ref, scheduled_date?, customer_name?, stops: [ … ] } ] }` |
| Delete | `DELETE /api/ingest/routes/[external_ref]?source=<source>` | — |

Naming note: `/api/route` (singular) already exists — it is the OSRM road-geometry/ETA proxy, unrelated. Ingestion lives under the `/api/ingest/*` namespace ("data pushed in"), so `…/ingest/routes` does not collide.

This **renames** the current `POST /api/ingest/stops` → `POST /api/ingest/routes` and its body key `orders` → `routes`. It's a clean cut: the only callers are ours (`scripts/seed-stops.ts`, `scripts/adapters/csv-to-stops.example.ts`, docs), all updated in the same change. No alias kept.

### Create + Update (already implemented, just re-pathed)

The logic exists today as `ingest_stops(p_orders jsonb)` (migration 0006) and needs **no DB change**:

- Upsert each route by `(source, external_ref)` (`on conflict … do update`).
- `delete from stops where order_id = …` then re-insert → **replace-set** the tour.
- Each stop carries `vehicle_id` + `area_id` (UUIDs) + `stop_type`, `seq`, `lat`, `lng`, `address?`, `eta_at?`.

Re-sending the same route updates it in place. The handler just reads `{ routes }` and passes the array to the existing RPC (the internal RPC keeps its name; it operates on the `orders`/`stops` tables). **Zero migrations for the whole feature.**

### Delete (the only new behaviour)

Delete already works at the DB layer — `stops.order_id` is `on delete cascade`, and the dispatcher RLS policy (`for all`) permits `delete on orders`. Deleting the `orders` row removes its stops; because `stops` is published to Realtime with `replica identity full`, the DELETE payloads carry `vehicle_id`, so the TV evicts those markers automatically. Only the HTTP route is missing.

`DELETE /api/ingest/routes/[external_ref]?source=<source>`

- **Auth:** Bearer token → dispatcher (`bearerToken` + `createUserClient`).
- **Params:** `external_ref` (path, required, non-empty); `source` (query, optional, defaults to `'manual'` — matching the create default, so a client that sets a non-default `source` on create must pass the same `?source=` on delete).
- **Action:** `from("orders").delete().eq("source", source).eq("external_ref", external_ref).select("id")`.
- **Responses:** `200 { ok: true }` deleted · `400` bad `external_ref` · `401` no/invalid token · `404 { error: "no such route" }` (no match, or RLS hid it) · `500` db error.

New files: `app/api/ingest/routes/route.ts` (POST, moved from `…/stops/route.ts`) and `app/api/ingest/routes/[external_ref]/route.ts` (DELETE, mirrors `app/api/stops/[id]/route.ts`).

### Delete semantics

**Hard delete (cascade)** for V1 — matches the client's literal "delete", simplest correct outcome, and the van's GPS history in `vehicle_positions` is a separate, retained table. If the client later wants cancelled routes kept for audit, the handler flips to a soft delete (`update orders set status='cancelled'` + delete only active stops) with no API change. Noted, not built.

## The client's payload → canonical body (adapter seam)

The endpoint accepts fleetmap's **canonical** body (the `{ routes: [ … ] }` shape above), validated by `lib/ingest-validate.ts`; `vehicle_id` and `area_id` are **UUIDs**.

The client will identify vans and cities by **their own codes**, not our UUIDs. That resolution (`van-code → vehicle_id`, `city → area_id`) and the field mapping from their format live in a thin **adapter** — the same seam as `scripts/adapters/csv-to-stops.example.ts` — which produces the canonical body and calls the endpoint. The core API/DB layer stays UUID-based and unchanged.

**This is the only part that waits on the client.** Everything else is built and tested now against the canonical contract; the adapter is filled in when we get (1) a sample route payload and (2) how they reference vehicles.

## Out of scope / deferred (YAGNI)

- **No `delivery_routes` table.** Add only if the feed nests multiple distinct customer-orders inside one route, each needing its own identity/PII/status.
- **No `orders.vehicle_id`.** Route→van assignment stays on the stops (as the seed already does); revisit if route-level reassign becomes common.
- **No soft-delete / audit retention** unless requested.
- **No DB migration.** The rename is HTTP-layer only; the RPC and tables are unchanged.

## Testing

- Unit (vitest): extend the `lib/ingest-validate` suite — validate the `{ routes }` body (rename from `orders`) and a new `validateDeleteParams` (non-empty `external_ref`, optional `source`).
- Manual: `POST` a route → it appears on the TV; re-`POST` with a changed stop → updates in place; `DELETE` it → its markers disappear.

## Files touched

- **New:** `app/api/ingest/routes/route.ts` (POST — moved from `app/api/ingest/stops/route.ts`); `app/api/ingest/routes/[external_ref]/route.ts` (DELETE).
- **Removed:** `app/api/ingest/stops/` (old path).
- **Edit:** `lib/ingest-validate.ts` (`orders` → `routes` key + `validateDeleteParams`) and its test; `scripts/seed-stops.ts` + `scripts/adapters/csv-to-stops.example.ts` (new path + body key); `CLAUDE.md` layout + ingestion convention (CRUD now complete; endpoint renamed).
- **Later (blocked on client):** an adapter that maps their format → canonical and resolves van/city codes.

## Open dependency

From the client, eventually: one sample **route payload** and how they **identify vehicles** (their code vs. our UUID). Not blocking — core build proceeds against the canonical contract.
