import { type NextRequest } from "next/server"
import { mintSession } from "@/lib/mint-session"

export const runtime = "nodejs"

// Mints a dispatcher session from server-only credentials, gated by a shared
// ingest secret. Mirrors the dashboard session: the password never reaches a
// client — only the minted dispatcher session tokens do. Used by the dev seed
// script and (later) an unattended server-to-server feed adapter.
export async function POST(request: NextRequest) {
  return mintSession({
    expectedSecret: process.env.DISPATCHER_INGEST_SECRET,
    presentedSecret: request.headers.get("x-ingest-secret"),
    email: process.env.DISPATCHER_EMAIL,
    password: process.env.DISPATCHER_PASSWORD,
    label: "dispatcher",
  })
}
