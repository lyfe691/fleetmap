// Upstream shapes — Bubble Box's fleet API as shipped on staging 2026-07-22
// (GET /api/v2/fleet/rider-routes; sample checked in at
// docs/bubblebox-fleet-routes-example.json). This module is the only place
// that knows their field names.
export type BBPointOrder = {
  orderCode: string
  type: "pickup" | "delivery"
}

export type BBRoutePoint = {
  type: string // pickup | delivery | collective | startPoint | endPoint
  // Order-lifecycle status projected onto the point (processing | done |
  // picked_up | ready_for_delivery | loaded_for_delivery). Stop completion is
  // keyed on actualFulfillmentTime instead — set exactly when the rider
  // fulfilled the point, whatever the status string says.
  status: string
  arrivalTime?: string | null // absent on startPoint
  actualFulfillmentTime?: string | null
  // Their backend serializes decimals as strings ("47.32452290") — accept
  // both. A few points arrive with null coordinates (geocoding gaps).
  latitude: number | string | null
  longitude: number | string | null
  orders: BBPointOrder[]
}

export type BBRoute = {
  rider: { id: number; fullName: string }
  dueDate: string // datetime at Zurich midnight — the date part is the day
  type: "morning" | "evening"
  routePoints: BBRoutePoint[]
}

// Slim status tier — not shipped yet (the full endpoint is cheap enough to
// poll); kept for the isShort/status endpoint Dmytro floated.
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

function statusKey(orderCode: string, type: "pickup" | "delivery"): string {
  return `${orderCode}:${type}`
}

/**
 * Pure translation: rider routes (+ optional fresher status entries) → one
 * PUT payload per mapped vehicle. Every vehicle in riderToVehicle gets a
 * payload — an empty orders list is how a van's synced stops are cleared when
 * its routes vanish. Riders with no matching vehicle and points unusable as
 * stops (no coordinates or no arrival time) are reported, not silently
 * dropped. riderToVehicle is keyed on the rider id as text — what
 * vehicles.rider_ref holds.
 */
export function buildSyncPayloads(
  routes: BBRoute[],
  statuses: BBStatusEntry[] | null,
  riderToVehicle: Map<string, string>
): {
  payloads: SyncPayload[]
  unmatchedRiders: string[]
  droppedOrderCodes: string[]
} {
  const overrides = new Map<string, BBStatusEntry>()
  for (const s of statuses ?? []) overrides.set(statusKey(s.orderCode, s.type), s)

  const routesByVehicle = new Map<string, BBRoute[]>()
  const unmatched = new Set<string>()
  for (const r of routes) {
    const vehicleId = riderToVehicle.get(String(r.rider.id))
    if (!vehicleId) {
      unmatched.add(`${r.rider.id} (${r.rider.fullName})`)
      continue
    }
    const list = routesByVehicle.get(vehicleId) ?? []
    list.push(r)
    routesByVehicle.set(vehicleId, list)
  }

  const payloads: SyncPayload[] = []
  const dropped: string[] = []
  for (const vehicleId of riderToVehicle.values()) {
    const vehicleRoutes = routesByVehicle.get(vehicleId) ?? []

    const points: { point: BBRoutePoint; date: string }[] = []
    for (const r of vehicleRoutes) {
      for (const point of r.routePoints) {
        if (DEPOT_TYPES.has(point.type) || point.orders.length === 0) continue
        if (point.latitude == null || point.longitude == null || !point.arrivalTime) {
          for (const po of point.orders) dropped.push(po.orderCode)
          continue
        }
        points.push({ point, date: r.dueDate.slice(0, 10) })
      }
    }
    points.sort(
      (a, b) =>
        Date.parse(a.point.arrivalTime ?? "") - Date.parse(b.point.arrivalTime ?? "")
    )

    const orders = new Map<string, SyncOrder>()
    let seq = 0
    for (const { point, date } of points) {
      for (const po of point.orders) {
        const override = overrides.get(statusKey(po.orderCode, po.type))
        const completedAt = override
          ? (override.fulfilledAt ?? null)
          : (point.actualFulfillmentTime ?? null)

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
          status: completedAt ? "completed" : "planned",
          eta_at: point.arrivalTime ?? "",
          completed_at: completedAt,
        })
        orders.set(po.orderCode, order)
      }
    }

    payloads.push({ vehicleId, orders: [...orders.values()] })
  }

  return {
    payloads,
    unmatchedRiders: [...unmatched],
    droppedOrderCodes: dropped,
  }
}
