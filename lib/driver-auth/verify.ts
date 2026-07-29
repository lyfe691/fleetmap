import type { BubbleboxClient } from "@/lib/bubblebox/client"

export class TokenInvalidError extends Error {}

/** Only the authenticated-call half of the client is needed here. */
export type RiderTokenVerifier = Pick<BubbleboxClient, "authedFetch">

/**
 * Verify a Bubble Box rider token and extract the rider identity.
 *
 * Bubble Box owns verification: we POST the token the app sent us to their
 * `/fleet/verify-rider-token`, authenticated with our fleet token. They answer
 * `{ id, fullName }`, where `id` is the same rider id `/fleet/rider-routes`
 * reports, which is what `vehicles.rider_ref` holds. `fullName` is ignored on
 * purpose; this service stores no PII.
 *
 * The status split is the contract that matters. A 403 means their token is
 * bad or expired, and expiry is the common case because it lives 2 minutes.
 * Every other failure is ours (fleet credentials rejected, their API down,
 * network) and must surface as a 500, never as "invalid token" to a driver.
 */
export async function verifyRiderToken(
  token: string,
  bb: RiderTokenVerifier
): Promise<{ riderId: string }> {
  const res = await bb.authedFetch("/api/v2/fleet/verify-rider-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ riderAuthToken: token }),
  })

  if (res.status === 403) {
    throw new TokenInvalidError("bubble box rejected the rider token (403)")
  }
  if (!res.ok) {
    throw new Error(`verify-rider-token failed (${res.status})`)
  }

  const body = (await res.json()) as { id?: unknown }
  if (typeof body.id !== "number" || !Number.isInteger(body.id)) {
    throw new Error("verify-rider-token returned no integer id")
  }
  return { riderId: String(body.id) }
}
