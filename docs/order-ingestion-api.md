# Fleetmap — Order Ingestion API

**Draft for the Bubble Box integration.** This describes how your booking system
pushes delivery orders into Fleetmap so they appear on the office monitoring
screen. It is an internal integration between our two systems — not a public API.

> **Two things we need to agree before you build against this** — both flagged in
> place below:
> 1. **Locations** — can you send geographic coordinates, or only street
>    addresses? (see *Locations*)
> 2. Everything else is settled; the endpoint is live and ready.

---

## Concepts

- An **order** is one customer job: a pickup (collect laundry) and, later, a
  return (deliver it back). You identify each order by **your own id**
  (`external_ref`) — we never require you to know ours.
- An order carries one or more **stops**. A normal laundry job is a `pickup`
  now and a `dropoff` added later when the clean laundry is ready. You can send
  the pickup alone and add the return in a later update, or send both at once.
- **You do not assign vans.** Which vehicle serves an order is our dispatch
  decision, made on our side — you never send vehicle information. Just send the
  order and where it is.

---

## Base URL

```
https://fleet.ysz.life
```

## Authentication

Two steps. First, exchange a **shared secret** (we give you this out of band)
for a short-lived access token:

```http
POST /api/dispatcher-session
x-ingest-secret: <the shared secret we give you>
```

Response:

```json
{ "access_token": "eyJhbGci…", "refresh_token": "…" }
```

The `access_token` is valid for ~1 hour. Mint one at the start of a batch (or
per request) and send it as a Bearer token on every ingestion call:

```http
Authorization: Bearer <access_token>
```

---

## Create or update orders

```http
POST /api/ingest/routes
Authorization: Bearer <access_token>
Content-Type: application/json
```

Body:

```json
{
  "routes": [
    {
      "external_ref": "BB-2026-00412",
      "source": "bubblebox",
      "customer_name": "M. Müller",
      "scheduled_date": "2026-07-03",
      "stops": [
        {
          "stop_type": "pickup",
          "seq": 1,
          "lat": 47.3769,
          "lng": 8.5417,
          "address": "Bahnhofstrasse 1, 8001 Zürich",
          "eta_at": "2026-07-03T09:00:00+02:00"
        }
      ]
    }
  ]
}
```

Send an array — one call can carry many orders.

### Fields

| Field | Required | Notes |
|---|---|---|
| `external_ref` | **yes** | Your order id. The idempotency key (see below). |
| `source` | no | A fixed label identifying your feed. Use `"bubblebox"`. Defaults to `"manual"` if omitted — **set it**, so your orders never collide with hand-entered ones. |
| `customer_name` | no | Shown to dispatch only; never displayed on the public screen. |
| `scheduled_date` | no | ISO date (`YYYY-MM-DD`). |
| `stops[]` | **yes** | At least one. |
| `stops[].stop_type` | **yes** | `"pickup"` or `"dropoff"`. |
| `stops[].seq` | **yes** | Visit order within the order: pickup `1`, dropoff `2`. |
| `stops[].lat` / `stops[].lng` | **yes** | Coordinates — see *Locations* below. |
| `stops[].address` | no | Human-readable label, shown to dispatch. |
| `stops[].eta_at` | no | ISO timestamp — the planned time window start, if you have one. |

### Idempotency (this is how updates work)

Each order is keyed by **`(source, external_ref)`**. Re-sending the same
`external_ref` **updates that order in place** and replaces its stop list with
whatever you send. So:

- Send the pickup today; send the same `external_ref` again next week with
  `pickup` + `dropoff` to add the return.
- Correcting an address = re-send with the fixed value.
- There is no separate "update" call — create and update are the same request.

> **Note:** re-sending replaces the whole stop list for that order, so always
> include every stop the order should currently have, not just the new one.

---

## Delete an order

```http
DELETE /api/ingest/routes/{external_ref}?source=bubblebox
Authorization: Bearer <access_token>
```

Removes the order and its stops; they disappear from the screen within a
second. `source` must match what you created it with.

---

## Responses

| Status | Meaning |
|---|---|
| `200 { "ok": true }` | Success. |
| `400 { "error": "…" }` | Bad input — the message says what (e.g. missing `external_ref`, `lat` out of range). |
| `401` | Missing or expired token — mint a fresh one. |
| `404 { "error": "no such route" }` | (DELETE only) nothing matched that `source` + `external_ref`. |

---

## ⚠ Open item — Locations

The endpoint currently stores each stop as **coordinates** (`lat`/`lng`),
because the map needs a point to draw. Your bookings capture **street
addresses**. So we need to know:

- **If your booking system already has coordinates** (many address-autocomplete
  widgets return them) → send them as `lat`/`lng`, and `address` as the label.
  Nothing more to do.
- **If you only have the address string** → tell us. We'll add address→coordinate
  resolution on our side, and you'd then send just the `address` field and skip
  `lat`/`lng`. This is a small change on our end, but we need to build it before
  you go live, so we need to know which case you're in.

**This is the one thing that blocks finalizing the contract.** Everything else
above is ready today.

---

## What happens after you send

An order you push lands in Fleetmap unassigned. Our dispatcher assigns it to a
van; from that point it rides the live route on the monitoring screen — traveled
portion greying out, ETA to the next stop, and so on. You don't see or manage
any of that; you just keep the order data in sync via the calls above.
