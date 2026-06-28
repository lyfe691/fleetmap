import type { NextRequest } from "next/server"

/** Extract the Bearer token from the Authorization header, or null. */
export function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization")
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null
}

/** Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500. */
export function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}
