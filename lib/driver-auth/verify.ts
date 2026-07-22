import { importSPKI, jwtVerify } from "jose"

export class TokenInvalidError extends Error {}
export class NotARiderTokenError extends Error {}

/**
 * Verify a Bubble Box login JWT and extract the rider identity.
 *
 * Their payload is Lexik-style (no sub/iss/aud):
 * `{ iat, exp, admin: { uuid, username, roles, rider: { id } | null, … } }`.
 * The rider object being present IS the trust boundary — fleet/staff tokens
 * verify against the same key but carry `rider: null` and must never mint a
 * driver session. The returned riderId (id as text) is what
 * `vehicles.rider_ref` holds.
 */
export async function verifyRiderToken(
  token: string,
  publicKeyPem: string
): Promise<{ riderId: string }> {
  let payload: unknown
  try {
    const key = await importSPKI(publicKeyPem, "RS256")
    const res = await jwtVerify(token, key, { algorithms: ["RS256"] })
    payload = res.payload
  } catch (err) {
    throw new TokenInvalidError(
      err instanceof Error ? err.message : String(err)
    )
  }

  const rider = (payload as { admin?: { rider?: { id?: unknown } | null } })
    ?.admin?.rider
  const id = rider?.id
  if (typeof id !== "number" || !Number.isInteger(id)) {
    throw new NotARiderTokenError("token carries no rider identity")
  }
  return { riderId: String(id) }
}
