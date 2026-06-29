/**
 * Adapter #2 (STUB) — example only, not wired into package.json.
 *
 * The client's real export format is still unknown. This shows the *shape* of
 * mapping an external export into the `POST /api/ingest/routes` contract —
 * proving the ingestion seam holds without building a live feed. Swap `CsvRow`
 * + the mapping for the real source when known; the contract below does not change.
 */

// One flat row as a generic CSV/ERP export might provide it.
type CsvRow = {
  route_ref: string
  customer: string
  pickup_lat: string
  pickup_lng: string
  dropoff_lat: string
  dropoff_lng: string
  vehicle_id: string
  pickup_seq: string
  dropoff_seq: string
}

// The exact POST /api/ingest/routes contract (see app/api/ingest/routes/route.ts).
type IngestPayload = {
  routes: {
    external_ref: string
    source: string
    customer_name?: string
    stops: {
      stop_type: "pickup" | "dropoff"
      vehicle_id: string
      seq: number
      lat: number
      lng: number
    }[]
  }[]
}

export function mapCsvRowsToIngestPayload(rows: CsvRow[]): IngestPayload {
  return {
    routes: rows.map((r) => ({
      external_ref: r.route_ref,
      source: "csv",
      customer_name: r.customer,
      stops: [
        {
          stop_type: "pickup",
          vehicle_id: r.vehicle_id,
          seq: Number(r.pickup_seq),
          lat: Number(r.pickup_lat),
          lng: Number(r.pickup_lng),
        },
        {
          stop_type: "dropoff",
          vehicle_id: r.vehicle_id,
          seq: Number(r.dropoff_seq),
          lat: Number(r.dropoff_lat),
          lng: Number(r.dropoff_lng),
        },
      ],
    })),
  }
}

// Usage (illustrative — do not run): POST the payload to /api/ingest/routes with a
// dispatcher Bearer token, exactly as scripts/seed-stops.ts does.
