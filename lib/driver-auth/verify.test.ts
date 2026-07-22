import { beforeAll, describe, expect, it } from "vitest"
import { exportSPKI, generateKeyPair, SignJWT } from "jose"
import {
  NotARiderTokenError,
  TokenInvalidError,
  verifyRiderToken,
} from "./verify"

// Stand-in for Bubble Box's keypair until Dmytro hands over the real public
// key — the token payload mirrors their observed Lexik-style shape.
let privateKey: CryptoKey
let publicKeyPem: string

async function sign(
  payload: Record<string, unknown>,
  opts: { key?: CryptoKey; expiresIn?: string } = {}
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ typ: "JWT", alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "24h")
    .sign(opts.key ?? privateKey)
}

const riderPayload = (id: unknown) => ({
  admin: {
    uuid: "9c2e1f00-0000-0000-0000-000000000000",
    username: "rider_zurichcity1@bb.ch",
    fullName: "Rider Zurich City 1",
    roles: ["ROLE_USER"],
    assignedLaundry: null,
    rider: id === null ? null : { id, fullName: "Rider Zurich City 1" },
  },
})

beforeAll(async () => {
  const pair = await generateKeyPair("RS256")
  privateKey = pair.privateKey as CryptoKey
  publicKeyPem = await exportSPKI(pair.publicKey)
})

describe("verifyRiderToken", () => {
  it("accepts a valid rider token and returns the rider id as text", async () => {
    const token = await sign(riderPayload(6))
    await expect(verifyRiderToken(token, publicKeyPem)).resolves.toEqual({
      riderId: "6",
    })
  })

  it("rejects a non-rider token (rider is null, e.g. fleet/staff logins)", async () => {
    const token = await sign(riderPayload(null))
    await expect(verifyRiderToken(token, publicKeyPem)).rejects.toBeInstanceOf(
      NotARiderTokenError
    )
  })

  it("rejects a token without the expected payload shape", async () => {
    const token = await sign({ some: "thing" })
    await expect(verifyRiderToken(token, publicKeyPem)).rejects.toBeInstanceOf(
      NotARiderTokenError
    )
  })

  it("rejects a rider object without a usable id", async () => {
    const token = await sign(riderPayload("not-a-number"))
    await expect(verifyRiderToken(token, publicKeyPem)).rejects.toBeInstanceOf(
      NotARiderTokenError
    )
  })

  it("rejects a token signed by a different key", async () => {
    const other = await generateKeyPair("RS256")
    const token = await sign(riderPayload(6), {
      key: other.privateKey as CryptoKey,
    })
    await expect(verifyRiderToken(token, publicKeyPem)).rejects.toBeInstanceOf(
      TokenInvalidError
    )
  })

  it("rejects an expired token", async () => {
    const token = await sign(riderPayload(6), { expiresIn: "-1h" })
    await expect(verifyRiderToken(token, publicKeyPem)).rejects.toBeInstanceOf(
      TokenInvalidError
    )
  })

  it("rejects tokens with a non-RS256 algorithm (no HS256 downgrade)", async () => {
    const hsToken = await new SignJWT(riderPayload(6))
      .setProtectedHeader({ typ: "JWT", alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(new TextEncoder().encode("shared-secret"))
    await expect(verifyRiderToken(hsToken, publicKeyPem)).rejects.toBeInstanceOf(
      TokenInvalidError
    )
  })
})
