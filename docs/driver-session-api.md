# Fleetmap — Driver Session Exchange

**For the Bubblebox rider app (Roman).** One call replaces the second
(Supabase) login: exchange the Bubble Box token the app already holds for a
Supabase session, then use that session for GPS exactly as today. Drivers only
ever log in to Bubble Box.

## The call

```http
POST https://fleet.ysz.life/api/driver-session
Content-Type: application/json

{ "token": "<the Bubble Box JWT the app holds after BB login>" }
```

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

- On app start, if there is no stored Supabase session or its refresh fails.
- That's it. One exchange bootstraps the shift; Supabase-managed refresh does
  the rest. Re-exchange only when refresh ultimately fails (e.g. after weeks
  offline) — the BB token in hand must then still be fresh (BB tokens live 24 h),
  which it is whenever the driver has the BB app open.

## Errors

| Status | Meaning | App behavior |
|---|---|---|
| `401 { "error": "invalid token" }` | BB token expired/invalid, or not a rider token | Re-login to Bubble Box, then retry |
| `403 { "error": "no vehicle mapped for this rider" }` | This rider has no van in Fleetmap yet | Show nothing / skip tracking — an ops task, not an app error |
| `400` | Malformed request | Bug — check the body shape |
| `500` | Exchange failed server-side | Retry with backoff |

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
- Call `POST /api/driver-session` once on start, feed the result into the
  Supabase client.
- `POST /api/location` and everything else stays byte-identical.

No driver passwords exist anywhere in this flow: the first exchange for a new
rider auto-creates their Fleetmap identity server-side.
