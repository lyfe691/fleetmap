function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

function isIsoDateString(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v))
}

export function validate(body: unknown): { orders: unknown[] } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const orders = (body as Record<string, unknown>).orders
  if (!Array.isArray(orders) || orders.length === 0) {
    return { error: "orders must be a non-empty array" }
  }
  for (const o of orders) {
    if (typeof o !== "object" || o === null) {
      return { error: "each order must be an object" }
    }
    const ord = o as Record<string, unknown>
    if (typeof ord.external_ref !== "string" || ord.external_ref.length === 0) {
      return { error: "order.external_ref is required" }
    }
    if (!Array.isArray(ord.stops) || ord.stops.length === 0) {
      return { error: "order.stops must be a non-empty array" }
    }
    if (
      ord.scheduled_date != null &&
      ord.scheduled_date !== "" &&
      !isIsoDateString(ord.scheduled_date)
    ) {
      return { error: "order.scheduled_date must be an ISO 8601 date" }
    }
    for (const s of ord.stops) {
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
      if (
        st.vehicle_id != null &&
        st.vehicle_id !== "" &&
        !isUuid(st.vehicle_id)
      ) {
        return { error: "stop.vehicle_id must be a UUID" }
      }
      if (st.area_id != null && st.area_id !== "" && !isUuid(st.area_id)) {
        return { error: "stop.area_id must be a UUID" }
      }
      if (
        st.eta_at != null &&
        st.eta_at !== "" &&
        !isIsoDateString(st.eta_at)
      ) {
        return { error: "stop.eta_at must be an ISO 8601 timestamp" }
      }
    }
  }
  return { orders }
}
