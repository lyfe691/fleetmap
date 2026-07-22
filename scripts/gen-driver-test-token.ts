/**
 * Dev-only: stand-in for Bubble Box's auth until their public key is wired.
 *
 * First run generates an RS256 keypair into .driver-auth-dev/ (gitignored)
 * and prints the BB_DRIVER_JWT_PUBLIC_KEY_B64 value for .env. Every run signs
 * a rider token for the given rider id (default 6) so the exchange service
 * can be exercised end to end locally.
 *
 *   pnpm driver-test-token [riderId]
 *   pnpm driver-test-token --fleet     # a rider:null token (must be rejected)
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from "jose"

const DIR = ".driver-auth-dev"
const PRIVATE_PEM = join(DIR, "private.pem")
const PUBLIC_PEM = join(DIR, "public.pem")

async function ensureKeys(): Promise<void> {
  if (existsSync(PRIVATE_PEM)) return
  mkdirSync(DIR, { recursive: true })
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  })
  writeFileSync(PRIVATE_PEM, await exportPKCS8(privateKey))
  writeFileSync(PUBLIC_PEM, await exportSPKI(publicKey))
  console.log(`Generated a new test keypair in ${DIR}/`)
}

async function main(): Promise<void> {
  await ensureKeys()

  const publicPem = readFileSync(PUBLIC_PEM, "utf8")
  console.log("\nBB_DRIVER_JWT_PUBLIC_KEY_B64 for .env:\n")
  console.log(Buffer.from(publicPem).toString("base64"))

  const fleet = process.argv.includes("--fleet")
  const riderId = Number(process.argv[2]) || 6
  const key = await importPKCS8(readFileSync(PRIVATE_PEM, "utf8"), "RS256")
  const token = await new SignJWT({
    admin: {
      uuid: "00000000-0000-0000-0000-00000000dev0",
      username: fleet ? "fleet-test@dev" : `rider-${riderId}@dev`,
      fullName: fleet ? "Fleet test" : `Rider ${riderId}`,
      roles: ["ROLE_USER"],
      assignedLaundry: null,
      rider: fleet ? null : { id: riderId, fullName: `Rider ${riderId}` },
    },
  })
    .setProtectedHeader({ typ: "JWT", alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key)

  console.log(
    `\nSigned ${fleet ? "FLEET (must be rejected)" : `rider ${riderId}`} token:\n`
  )
  console.log(token)
}

void main()
