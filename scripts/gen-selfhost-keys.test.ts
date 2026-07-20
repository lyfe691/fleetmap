import { describe, expect, it } from "vitest"
import { createHmac } from "node:crypto"
import { generateKeys, signJwt } from "./gen-selfhost-keys"

const decode = (jwt: string) => {
  const [h, p, s] = jwt.split(".")
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
    resign: createHmac("sha256", "test-secret").update(`${h}.${p}`).digest("base64url") === s,
  }
}

describe("gen-selfhost-keys", () => {
  it("signs HS256 JWTs verifiable with the secret", () => {
    const jwt = signJwt({ role: "anon", iss: "supabase" }, "test-secret")
    const d = decode(jwt)
    expect(d.header).toEqual({ alg: "HS256", typ: "JWT" })
    expect(d.payload.role).toBe("anon")
    expect(d.resign).toBe(true)
  })

  it("generates anon + service_role keys off one secret", () => {
    const keys = generateKeys("test-secret")
    expect(keys.jwtSecret).toBe("test-secret")
    expect(decode(keys.anonKey).payload.role).toBe("anon")
    expect(decode(keys.serviceRoleKey).payload.role).toBe("service_role")
    expect(decode(keys.anonKey).payload.exp - decode(keys.anonKey).payload.iat).toBe(315360000)
  })
})
