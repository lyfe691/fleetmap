// Upstream shapes — the contract agreed with Bubble Box (spec: "Upstream
// contract"). Field names may shift when their dedicated API lands; this
// module is the only place that knows them.
export type BBPointOrder = {
  orderCode: string
  type: "pickup" | "delivery"
}

export type BBRoutePoint = {
  type: string // pickup | delivery | collective | startPoint | endPoint
  status: string // processing | done | … (full enum pending)
  arrivalTime: string
  fulfilledAt?: string | null
  // Their backend serializes decimals as strings ("47.32452290") — accept both.
  latitude: number | string
  longitude: number | string
  orders: BBPointOrder[]
}

export type BBRoute = {
  riderRef: string
  date: string
  type: "morning" | "evening"
  routePoints: BBRoutePoint[]
}

export type BBStatusEntry = {
  orderCode: string
  type: "pickup" | "delivery"
  status: string
  fulfilledAt?: string | null
}

export type SyncStop = {
  stop_type: "pickup" | "dropoff"
  seq: number
  lat: number
  lng: number
  status: "planned" | "completed"
  eta_at: string
  completed_at: string | null
}

export type SyncOrder = {
  external_ref: string
  scheduled_date: string
  stops: SyncStop[]
}

export type SyncPayload = { vehicleId: string; orders: SyncOrder[] }

const DEPOT_TYPES = new Set(["startPoint", "endPoint"])

// Anything not "done" (including statuses we haven't seen yet) renders as a
// pending stop — wrong-but-safe until the full upstream enum is known.
function mapStatus(upstream: string): "planned" | "completed" {
  return upstream === "done" ? "completed" : "planned"
}

function statusKey(orderCode: string, type: "pickup" | "delivery"): string {
  return `${orderCode}:${type}`
}

/**
 * Pure translation: rider routes (+ optional fresher status entries) → one
 * PUT payload per mapped vehicle. Every vehicle in riderToVehicle gets a
 * payload — an empty orders list is how a van's synced stops are cleared when
 * its routes vanish. Riders with no matching vehicle are reported, not
 * silently dropped.
 */
export function buildSyncPayloads(
  routes: BBRoute[],
  statuses: BBStatusEntry[] | null,
  riderToVehicle: Map<string, string>
): { payloads: SyncPayload[]; unmatchedRiders: string[] } {
  const overrides = new Map<string, BBStatusEntry>()
  for (const s of statuses ?? []) overrides.set(statusKey(s.orderCode, s.type), s)

  const routesByVehicle = new Map<string, BBRoute[]>()
  const unmatched = new Set<string>()
  for (const r of routes) {
    const vehicleId = riderToVehicle.get(r.riderRef)
    if (!vehicleId) {
      unmatched.add(r.riderRef)
      continue
    }
    const list = routesByVehicle.get(vehicleId) ?? []
    list.push(r)
    routesByVehicle.set(vehicleId, list)
  }

  const payloads: SyncPayload[] = []
  for (const vehicleId of riderToVehicle.values()) {
    const vehicleRoutes = routesByVehicle.get(vehicleId) ?? []

    const points = vehicleRoutes
      .flatMap((r) =>
        r.routePoints
          .filter((p) => !DEPOT_TYPES.has(p.type) && p.orders.length > 0)
          .map((p) => ({ point: p, date: r.date }))
      )
      .sort(
        (a, b) => Date.parse(a.point.arrivalTime) - Date.parse(b.point.arrivalTime)
      )

    const orders = new Map<string, SyncOrder>()
    let seq = 0
    for (const { point, date } of points) {
      for (const po of point.orders) {
        const override = overrides.get(statusKey(po.orderCode, po.type))
        const status = mapStatus(override?.status ?? point.status)
        const fulfilledAt = override?.fulfilledAt ?? point.fulfilledAt ?? null

        const order = orders.get(po.orderCode) ?? {
          external_ref: po.orderCode,
          scheduled_date: date,
          stops: [],
        }
        order.stops.push({
          stop_type: po.type === "delivery" ? "dropoff" : "pickup",
          seq: ++seq,
          lat: Number(point.latitude),
          lng: Number(point.longitude),
          status,
          eta_at: point.arrivalTime,
          completed_at: status === "completed" ? fulfilledAt : null,
        })
        orders.set(po.orderCode, order)
      }
    }

    payloads.push({ vehicleId, orders: [...orders.values()] })
  }

  return { payloads, unmatchedRiders: [...unmatched] }
}
