function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

function isIsoDateString(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v))
}

export function validate(body: unknown): { routes: unknown[] } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const routes = (body as Record<string, unknown>).routes
  if (!Array.isArray(routes) || routes.length === 0) {
    return { error: "routes must be a non-empty array" }
  }
  for (const r of routes) {
    if (typeof r !== "object" || r === null) {
      return { error: "each route must be an object" }
    }
    const route = r as Record<string, unknown>
    if (typeof route.external_ref !== "string" || route.external_ref.length === 0) {
      return { error: "route.external_ref is required" }
    }
    if (!Array.isArray(route.stops) || route.stops.length === 0) {
      return { error: "route.stops must be a non-empty array" }
    }
    if (
      route.scheduled_date != null &&
      route.scheduled_date !== "" &&
      !isIsoDateString(route.scheduled_date)
    ) {
      return { error: "route.scheduled_date must be an ISO 8601 date" }
    }
    for (const s of route.stops) {
      if (typeof s !== "object" || s === null) {
        return { error: "each stop must be an object" }
      }
      const st = s as Record<string, unknown>
      if (st.stop_type !== "pickup" && st.stop_type !== "dropoff") {
        return { error: "stop.stop_type must be 'pickup' or 'dropoff'" }
      }
      if (!Number.isInteger(st.seq)) {
        return { error: "stop.seq must be an integer" }
      }
      if (!isFiniteNumber(st.lat) || st.lat < -90 || st.lat > 90) {
        return { error: "stop.lat must be a number in [-90, 90]" }
      }
      if (!isFiniteNumber(st.lng) || st.lng < -180 || st.lng > 180) {
        return { error: "stop.lng must be a number in [-180, 180]" }
      }
      if (st.vehicle_id != null && st.vehicle_id !== "" && !isUuid(st.vehicle_id)) {
        return { error: "stop.vehicle_id must be a UUID" }
      }
      if (st.area_id != null && st.area_id !== "" && !isUuid(st.area_id)) {
        return { error: "stop.area_id must be a UUID" }
      }
      if (st.eta_at != null && st.eta_at !== "" && !isIsoDateString(st.eta_at)) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
    }
  }
  return { routes }
}

const STOP_STATUSES = new Set(["planned", "arrived", "completed", "failed", "skipped"])

export function validateVehicleRoutes(body: unknown):
  | { vehicle_id: string; orders: unknown[] }
  | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const { vehicle_id, orders } = body as Record<string, unknown>
  if (!isUuid(vehicle_id)) {
    return { error: "vehicle_id must be a uuid" }
  }
  // Empty is valid: the sync clears a vehicle by sending zero orders.
  if (!Array.isArray(orders)) {
    return { error: "orders must be an array" }
  }
  for (const o of orders) {
    if (typeof o !== "object" || o === null) {
      return { error: "each order must be an object" }
    }
    const order = o as Record<string, unknown>
    if (typeof order.external_ref !== "string" || order.external_ref.length === 0) {
      return { error: "order.external_ref is required" }
    }
    if (
      order.scheduled_date != null &&
      order.scheduled_date !== "" &&
      !isIsoDateString(order.scheduled_date)
    ) {
      return { error: "order.scheduled_date must be an ISO 8601 date" }
    }
    if (!Array.isArray(order.stops) || order.stops.length === 0) {
      return { error: "order.stops must be a non-empty array" }
    }
    for (const s of order.stops) {
      if (typeof s !== "object" || s === null) {
        return { error: "each stop must be an object" }
      }
      const st = s as Record<string, unknown>
      if (st.stop_type !== "pickup" && st.stop_type !== "dropoff") {
        return { error: "stop.stop_type must be 'pickup' or 'dropoff'" }
      }
      if (!Number.isInteger(st.seq)) {
        return { error: "stop.seq must be an integer" }
      }
      if (!isFiniteNumber(st.lat) || st.lat < -90 || st.lat > 90) {
        return { error: "stop.lat must be a number in [-90, 90]" }
      }
      if (!isFiniteNumber(st.lng) || st.lng < -180 || st.lng > 180) {
        return { error: "stop.lng must be a number in [-180, 180]" }
      }
      if (typeof st.status !== "string" || !STOP_STATUSES.has(st.status)) {
        return { error: "stop.status must be one of planned|arrived|completed|failed|skipped" }
      }
      if (st.eta_at != null && st.eta_at !== "" && !isIsoDateString(st.eta_at)) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
      if (
        st.completed_at != null &&
        st.completed_at !== "" &&
        !isIsoDateString(st.completed_at)
      ) {
        return { error: "stop.completed_at must be an ISO 8601 timestamp" }
      }
    }
  }
  return { vehicle_id: vehicle_id as string, orders }
}

export function validateDeleteParams(input: {
  external_ref: unknown
  source: unknown
}): { external_ref: string; source: string } | { error: string } {
  const { external_ref, source } = input
  if (typeof external_ref !== "string" || external_ref.length === 0) {
    return { error: "external_ref is required" }
  }
  if (source != null && source !== "" && typeof source !== "string") {
    return { error: "source must be a string" }
  }
  const src = typeof source === "string" && source.length > 0 ? source : "manual"
  return { external_ref, source: src }
}
