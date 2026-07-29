# Fleetmap — Driver Session Exchange

**For the Bubblebox rider app (Roman).** One call replaces the second
(Supabase) login: exchange the `fleetAuthToken` Bubble Box issues at rider
login for a Supabase session, then use that session for GPS exactly as today.
Drivers only ever log in to Bubble Box.

> **Status, 2026-07-29 — do not release against this yet.** The endpoint is
> live and the request/response shape below is final, but it still verifies
> tokens against a placeholder key, so a **real `fleetAuthToken` gets a 401**.
> That is expected and is not a bug in the caller. Switching it over to Bubble
> Box's `verify-rider-token` endpoint is blocked on one thing from Dmytro; you
> will be told the moment it accepts real tokens. Everything else here is
> already correct, so the app can be built against it now.

## The call

```http
POST https://fleet.ysz.life/api/driver-session
Content-Type: application/json

{ "token": "<the fleetAuthToken from the Bubble Box login>" }
```

`fleetAuthToken` is the token the rider app receives at Bubble Box login
specifically for this exchange. It is not the token the rider app uses for
itself, and it **expires 2 minutes after it is issued**.

Callable from a browser: the `OPTIONS` preflight is answered and the CORS
headers ride every response, rejections included, so you get the real status
rather than a generic CORS error. Only `Content-Type` is on the allowed-header
list — if the client sends any other header, say so and it gets added.

Response `200`:

```json
{
  "access_token": "eyJ…",
  "refresh_token": "…",
  "expires_in": 3600,
  "expires_at": 1784732063
}
```

Feed this into the app's Supabase client (`setSession`) — or use `access_token`
directly as the Bearer for `POST /api/location`. The Supabase client refreshes
the session on its own for the rest of the shift; you do NOT need to re-exchange
per request.

## When to call it

The 2-minute lifetime is what shapes this. The old advice here assumed a 24 h
token and was wrong; the token is only alive immediately after login.

- **Right after the Bubble Box login**, while the `fleetAuthToken` is fresh.
  Not lazily when tracking first starts, and not when the location permission
  is granted — by then it may already be dead.
- One exchange bootstraps the session. Supabase-managed refresh keeps it alive
  from there; you do **not** re-exchange per request, per trip, or per shift.
- **Never re-exchange with a stored `fleetAuthToken`.** It expires in minutes,
  so a stored one is always dead. There is nothing to retry with.
- If Supabase refresh ultimately fails (e.g. after a long time offline, or a
  reinstall), the driver needs a **new Bubble Box login** to produce a fresh
  `fleetAuthToken`, and the exchange runs again off that.

## Errors

| Status | Meaning | App behavior |
|---|---|---|
| `401 { "error": "invalid token" }` | The `fleetAuthToken` is expired, invalid, or carries no rider identity. Expiry is the common case, since it lives 2 minutes | Get a fresh `fleetAuthToken` from a new Bubble Box login, then retry. Retrying with the same token always fails |
| `403 { "error": "no vehicle mapped for this rider" }` | This rider has no van in Fleetmap yet | Show nothing / skip tracking — an ops task, not an app error |
| `400` | Malformed request | Bug — check the body shape |
| `500 { "error": "exchange failed" }` | Something broke on the Fleetmap side, including reaching Bubble Box to verify the token | Retry with backoff. Do **not** bounce the driver to a login screen — the token is not the problem |

`401` and `500` are kept deliberately distinct: "your token is bad" and "we are
broken" need opposite responses from the app, and a verification call that fails
for network reasons must never reach the driver as a login error.

## The three constants

Fleetmap moved off managed Supabase onto its own server, so two of these are
new. All three are safe to keep in the app bundle — the publishable key is the
anon-role key that already ships publicly in the dashboard's JavaScript, and
row-level security is the actual boundary.

| Constant | Value |
|---|---|
| `API_BASE_URL` | `https://fleet.ysz.life` (unchanged) |
| Supabase URL | `https://sb.fleet.ysz.life` (new) |
| Supabase publishable key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NTM4MjE0LCJleHAiOjIwOTk4OTgyMTR9.WNVIZcMYo01TVYVAoqUdiMaxgE43tE8apjxkasLg3oM` (new) |

## What changes in the app

- Remove the Supabase email/password login UI + stored driver credentials.
- Point the Supabase client at the URL + key above.
- Call `POST /api/driver-session` once, immediately after the Bubble Box login,
  and feed the result into the Supabase client. Persist the session so a normal
  app start reuses it instead of exchanging again.
- `POST /api/location` and everything else stays byte-identical.

No driver passwords exist anywhere in this flow: the first exchange for a new
rider auto-creates their Fleetmap identity server-side.
