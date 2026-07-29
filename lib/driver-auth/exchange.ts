/**
 * Driver session exchange — decision logic only. Takes a rider token and,
 * via injected dependencies, decides how to answer: reject it, report an
 * unmapped rider, or mint a session. The worker (workers/driver-session.ts)
 * owns the HTTP transport, env, and the real Supabase admin client; this
 * module owns none of that so it can be unit-tested without a server or a
 * database.
 */

export type ExchangeSession = {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: number
}

export type ExchangeVehicle = {
  id: string
  assigned_user_id: string | null
}

export type ExchangeDeps = {
  /** Verify the caller's token and return the rider identity. */
  verifyToken: (token: string) => Promise<{ riderId: string }>
  /** True when the error means "the token is bad" (→ 401), not "we broke". */
  isTokenRejection: (err: unknown) => boolean
  findVehicle: (riderId: string) => Promise<ExchangeVehicle | null>
  emailForUser: (userId: string) => Promise<string>
  provisionDriver: (vehicleId: string, riderId: string) => Promise<string>
  mintSession: (email: string) => Promise<ExchangeSession>
  log: (
    level: "info" | "warn" | "error",
    event: string,
    fields?: Record<string, unknown>
  ) => void
}

export type ExchangeResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 401 | 403; body: { error: string } }

export async function exchangeRiderToken(
  token: string,
  deps: ExchangeDeps
): Promise<ExchangeResult> {
  let riderId: string
  try {
    ;({ riderId } = await deps.verifyToken(token))
  } catch (err) {
    if (deps.isTokenRejection(err)) {
      deps.log("warn", "token_rejected", {
        reason: err instanceof Error ? err.message : String(err),
      })
      return { status: 401, body: { error: "invalid token" } }
    }
    throw err
  }

  const vehicle = await deps.findVehicle(riderId)
  if (!vehicle) {
    deps.log("warn", "unmapped_rider", { rider: riderId })
    return { status: 403, body: { error: "no vehicle mapped for this rider" } }
  }

  let email: string
  if (vehicle.assigned_user_id) {
    email = await deps.emailForUser(vehicle.assigned_user_id)
  } else {
    email = await deps.provisionDriver(vehicle.id, riderId)
    deps.log("info", "driver_autoprovisioned", { rider: riderId })
  }

  const session = await deps.mintSession(email)
  deps.log("info", "session_minted", { rider: riderId })
  return {
    status: 200,
    body: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
    },
  }
}
