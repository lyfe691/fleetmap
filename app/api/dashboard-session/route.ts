import { type NextRequest } from "next/server"
import { mintSession } from "@/lib/mint-session"

export const runtime = "nodejs"

// Mints a read-only dashboard session from server-only credentials, gated by a
// shared display code. The dashboard password never reaches the browser — only
// the minted session tokens (for the claim-scoped, read-only dashboard user) do.
export async function POST(request: NextRequest) {
  return mintSession({
    expectedSecret: process.env.DASHBOARD_DISPLAY_CODE,
    presentedSecret: request.headers.get("x-display-code"),
    email: process.env.DASHBOARD_EMAIL,
    password: process.env.DASHBOARD_PASSWORD,
    label: "dashboard",
  })
}
