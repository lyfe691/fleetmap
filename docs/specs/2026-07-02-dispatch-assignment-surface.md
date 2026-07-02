# Dispatch as an assignment surface

**Date:** 2026-07-02 · **Status:** implemented

## Why

Bubble Box's order export (see `docs/order-ingestion-api.md`) has no concept of
vans or drivers — orders arrive with stops but nothing to say who drives them.
Auto-assignment was considered and rejected: real coverage rules (shop/locker/
partner territories, driver hours) aren't modeled, and guessing wrong on a
laundry route is worse than a ten-second human decision. So assignment is a
human step, and `/dispatch` is where it happens.

That flips the console's center of gravity. M12 built it order-intake-first
(form as the default tab) because the manual path was the only path. Once
orders flow in via the ingest API, the dispatcher's daily job is: look at what
came in, give each order a van, intervene when something goes wrong. The form
becomes the fallback for phone orders.

## What changed

- **The seam already supported it.** `stop.vehicle_id` was always nullable and
  optional in ingest validation, and `PATCH /api/stops/:id` already accepts
  `vehicle_id` + `seq`. Assigning an order = patching each of its unassigned
  stops with the chosen van and the next free seq (`base + i`, base from the
  client-side max-seq calc). No schema or API change.
- **Orders tab is the default** and is split into two groups: **Needs a van**
  (any stop with `vehicle_id null` — emphasized, with a van picker + Assign)
  and **Assigned** (the existing per-stop status/reassign/add-return/cancel
  controls, restyled). A stat strip (unassigned / in progress / vans) gives
  the at-a-glance read.
- **Per-stop reassign keeps an "unassign" escape hatch** (`vehicle_id: null`),
  so a mis-assigned stop can be thrown back into the pool.
- **The manual order form stays** as the second tab ("Manual order"), for
  orders that arrive by phone. Unassigned stops never reach the TV or the
  geofence — both key by `vehicle_id`, so the pool is dispatcher-only until
  assigned.

## Deliberately not now

- **Auto-assignment** — see above; revisit only if coverage rules get modeled.
- **Per-person dispatcher accounts.** RLS keys on the `role='dispatcher'`
  claim, not on a specific user, so more dispatcher identities are a
  provisioning exercise (`scripts/provision-dispatcher.ts`), not a refactor.
  Do it when a second real dispatcher exists.
- **Reordering stops within a van's day** (drag-to-reorder). `seq` supports it
  (`PATCH` accepts `seq`); the UI earns it once real multi-order days exist.
