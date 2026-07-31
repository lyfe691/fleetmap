type ExchangeSummary =
  | {
      status: number
      session: {
        access_token: "present" | "missing"
        refresh_token: "present" | "missing"
        expires_in: number | null
      }
    }
  | { status: number; error: string }

const FAILURE_BY_STATUS: Partial<Record<number, string>> = {
  400: "malformed request",
  401: "invalid token",
  403: "unmapped rider",
  413: "body too large",
  500: "exchange failed",
}

export function summarizeExchangeBody(
  status: number,
  text: string
): ExchangeSummary {
  if (status < 200 || status >= 300) {
    return {
      status,
      error: FAILURE_BY_STATUS[status] ?? "unexpected response",
    }
  }

  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // A malformed body is represented by missing fields, never echoed.
  }

  return {
    status,
    session: {
      access_token:
        typeof body.access_token === "string" && body.access_token.length > 0
          ? "present"
          : "missing",
      refresh_token:
        typeof body.refresh_token === "string" && body.refresh_token.length > 0
          ? "present"
          : "missing",
      expires_in: typeof body.expires_in === "number" ? body.expires_in : null,
    },
  }
}
