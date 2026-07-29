import type { BBRoute } from "@/lib/bubblebox/translate"

export type BubbleboxConfig = {
  baseUrl: string
  username: string
  password: string
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

export type BubbleboxClient = {
  /** Authenticated request against a BB fleet path, e.g. "/api/v2/fleet/…".
   *  Mints a token on first use, caches it, and re-mints once on a 401. */
  authedFetch(path: string, init?: RequestInit): Promise<Response>
  /** All rider routes for one Zurich-local date (YYYY-MM-DD). */
  fetchRiderRoutes(date: string): Promise<BBRoute[]>
}

export function createBubbleboxClient(config: BubbleboxConfig): BubbleboxClient {
  const { baseUrl, username, password, fetchImpl = fetch } = config
  let token: string | null = null

  async function mintToken(): Promise<string> {
    const res = await fetchImpl(`${baseUrl}/api/v2/fleet/authentication-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) throw new Error(`BB token denied (${res.status})`)
    const body = (await res.json()) as { data?: { loginToken?: string } }
    if (!body.data?.loginToken) {
      throw new Error("BB token response missing data.loginToken")
    }
    return body.data.loginToken
  }

  async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    token ??= await mintToken()
    const headers = { ...init.headers, accessToken: token }
    let res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers })
    if (res.status === 401) {
      token = await mintToken()
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, accessToken: token },
      })
    }
    return res
  }

  async function fetchRiderRoutes(date: string): Promise<BBRoute[]> {
    // Explicit bounds on both ends — their no-param default also means today,
    // but resolved in their server's idea of it.
    const path =
      `/api/v2/fleet/rider-routes` +
      `?dueDate[notEarlier]=${date}&dueDate[notLater]=${date}`
    const res = await authedFetch(path)
    if (!res.ok) throw new Error(`BB routes fetch failed (${res.status})`)
    return (await res.json()) as BBRoute[]
  }

  return { authedFetch, fetchRiderRoutes }
}
