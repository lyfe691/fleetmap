import { getBrowserClient } from "@/lib/supabase/browser"

// Outcome of exchanging a display code for a dashboard session. `invalid-code`
// is the wrong-code case (stay on the gate, show "Incorrect code"); everything
// else is `unavailable` (server/network — worth a retry with the same code).
export type ConnectResult =
  | { ok: true }
  | { ok: false; kind: "invalid-code" | "unavailable"; message: string }

/**
 * Exchanges the display code for a read-only dashboard session and installs it
 * on the shared browser client. This is the single place a session is minted —
 * the gate calls it before granting entry, so a wrong code never reaches the
 * console. The display code is the only persisted credential (localStorage); the
 * session tokens live in memory (persistSession: false) and are re-minted on
 * each load.
 */
export async function connectDashboard(code: string): Promise<ConnectResult> {
  let res: Response
  try {
    res = await fetch("/api/dashboard-session", {
      method: "POST",
      headers: { "x-display-code": code },
    })
  } catch {
    return {
      ok: false,
      kind: "unavailable",
      message: "Can't reach the dashboard. Check the connection.",
    }
  }

  if (res.status === 403) {
    return { ok: false, kind: "invalid-code", message: "Incorrect code." }
  }
  if (!res.ok) {
    return {
      ok: false,
      kind: "unavailable",
      message: "Dashboard unavailable. Try again.",
    }
  }

  const { access_token, refresh_token } = (await res.json()) as {
    access_token: string
    refresh_token: string
  }

  const { error } = await getBrowserClient().auth.setSession({
    access_token,
    refresh_token,
  })
  if (error) {
    return {
      ok: false,
      kind: "unavailable",
      message: "Couldn't start the session. Try again.",
    }
  }

  return { ok: true }
}
