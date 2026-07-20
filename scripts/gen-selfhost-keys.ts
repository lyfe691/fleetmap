import { createHmac, randomBytes } from "node:crypto"

const b64u = (v: string) => Buffer.from(v).toString("base64url")

export function signJwt(payload: object, secret: string): string {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64u(JSON.stringify(payload))
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")
  return `${head}.${body}.${sig}`
}

export function generateKeys(secret: string = randomBytes(32).toString("hex")) {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 315360000
  const mint = (role: string) => signJwt({ role, iss: "supabase", iat, exp }, secret)
  return { jwtSecret: secret, anonKey: mint("anon"), serviceRoleKey: mint("service_role") }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("gen-selfhost-keys.ts")) {
  console.log(JSON.stringify(generateKeys(process.env.JWT_SECRET || undefined), null, 2))
}
