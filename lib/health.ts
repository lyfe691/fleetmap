export type ServiceState = "ok" | "down" | null

export function summarizeHealth(parts: {
  supabaseOk: boolean
  osrmOk: boolean
  driverSessionOk: boolean | null
}) {
  return {
    ok: parts.supabaseOk && parts.osrmOk && parts.driverSessionOk !== false,
    supabase: parts.supabaseOk ? "ok" : "down",
    osrm: parts.osrmOk ? "ok" : "down",
    driver_session:
      parts.driverSessionOk == null
        ? null
        : parts.driverSessionOk
          ? "ok"
          : "down",
  } satisfies {
    ok: boolean
    supabase: ServiceState
    osrm: ServiceState
    driver_session: ServiceState
  }
}
