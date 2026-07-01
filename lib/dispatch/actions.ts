import type { SupabaseClient } from "@supabase/supabase-js"

export type ActionResult = { ok: true } | { ok: false; error: string }

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null)
  return (body && typeof body === "object" && "error" in body && typeof body.error === "string")
    ? body.error
    : `request failed (${res.status})`
}

/**
 * Create a brand-new manual order (one pickup stop). Goes through the real
 * ingestion contract (POST /api/ingest/routes) — safe here because there's
 * nothing existing to clobber. external_ref is generated client-side since
 * this order has no external system of record.
 */
export async function createOrder(opts: {
  accessToken: string
  customerName: string | null
  scheduledDate: string | null
  vehicleId: string
  lat: number
  lng: number
  address: string | null
  etaAt: string | null
  seq: number
}): Promise<ActionResult> {
  const res = await fetch("/api/ingest/routes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      routes: [
        {
          external_ref: `manual-${crypto.randomUUID()}`,
          source: "manual",
          customer_name: opts.customerName ?? undefined,
          scheduled_date: opts.scheduledDate ?? undefined,
          stops: [
            {
              stop_type: "pickup",
              vehicle_id: opts.vehicleId,
              seq: opts.seq,
              lat: opts.lat,
              lng: opts.lng,
              address: opts.address ?? undefined,
              eta_at: opts.etaAt ?? undefined,
            },
          ],
        },
      ],
    }),
  })
  if (!res.ok) return { ok: false, error: await readError(res) }
  return { ok: true }
}

/**
 * Add the return (dropoff) stop to an existing order, same address as the
 * pickup. A DIRECT insert into `stops`, not a re-POST to the ingest endpoint:
 * ingest_stops replace-sets an order's whole stop list on every call and the
 * insert never carries `status`, so it would reset an already-completed
 * pickup back to 'planned'. A single insert avoids that entirely — the
 * dispatcher's existing RLS ("dispatcher manages stops", 0004) already
 * permits it.
 */
export async function addReturnStop(opts: {
  supabase: SupabaseClient
  orderId: string
  vehicleId: string
  lat: number
  lng: number
  address: string | null
  seq: number
}): Promise<ActionResult> {
  const { error } = await opts.supabase.from("stops").insert({
    order_id: opts.orderId,
    vehicle_id: opts.vehicleId,
    stop_type: "dropoff",
    seq: opts.seq,
    lat: opts.lat,
    lng: opts.lng,
    address: opts.address,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Cancel (hard-delete) a whole order — stops cascade, the TV evicts them. */
export async function cancelOrder(opts: {
  accessToken: string
  source: string
  externalRef: string
}): Promise<ActionResult> {
  const res = await fetch(
    `/api/ingest/routes/${encodeURIComponent(opts.externalRef)}?source=${encodeURIComponent(opts.source)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${opts.accessToken}` } }
  )
  if (!res.ok) return { ok: false, error: await readError(res) }
  return { ok: true }
}

/** Status override or reassign (vehicle_id/seq) on one stop. */
export async function patchStop(opts: {
  accessToken: string
  stopId: string
  patch: Record<string, unknown>
}): Promise<ActionResult> {
  const res = await fetch(`/api/stops/${opts.stopId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.patch),
  })
  if (!res.ok) return { ok: false, error: await readError(res) }
  return { ok: true }
}
