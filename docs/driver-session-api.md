# Fleetmap - Driver Session Exchange

**For the Bubble Box rider app (Roman).** One exchange replaces the second
(Supabase) login. Drivers log in only to Bubble Box; Fleetmap returns the
Supabase session used for GPS exactly as today.

> **Release-proof warning, 2026-07-31.** The production endpoint already has
> the CORS and liveness update, but the Bubble Box verification-swap image has
> not been deployed yet. A real-token proof is also blocked by the supplied
> rider login fixture: Roman's legacy login path returned `404`, and Bubble
> Box's documented current login rejected the same fixture with `401`. Correct
> that path or account and complete the controlled proof before releasing the
> app. Do not send credentials in chat or commit them to this repository.

## Five-token glossary

These five tokens have different owners and lifetimes:

1. **Bubble Box rider access token (`loginToken`)** - returned by normal rider
   authentication and persisted by the rider app. It authorizes the rider app
   and can request token 2 without another interactive login.
2. **Bubble Box `fleetAuthToken`** - short-lived (approximately two minutes),
   requested on demand from `GET /api/v2/riders/fleet-auth-token` with token 1
   in the `accessToken` header. Read it from `data.fleetAuthToken`. This is the
   value the app sends to Fleetmap.
3. **Bubble Box fleet-service `loginToken`** - minted server-side by
   `POST /api/v2/fleet/authentication-token` from Fleetmap's fleet credentials
   and cached by Fleetmap (approximately 24-hour upstream lifetime). Fleetmap
   sends it as the private verification request's `accessToken` header. The
   rider app never sees it.
4. **Supabase `access_token`** - returned by Fleetmap and used to authorize
   `POST /api/location`.
5. **Supabase `refresh_token`** - returned by Fleetmap, persisted with token 4,
   and used by the Supabase client to keep the driver session alive.

`riderAuthToken` is not a sixth token. It is only Bubble Box's private request
field name for the same value as token 2. The public Fleetmap request remains
`{ "token": "<fleetAuthToken>" }`; Fleetmap privately forwards that value as
`{ "riderAuthToken": "<fleetAuthToken>" }`.

## Acquire and exchange immediately after login

After a successful Bubble Box rider login, use the returned rider
`loginToken` to obtain a fresh Fleetmap-scoped token:

```http
GET <BUBBLE_BOX_BASE_URL>/api/v2/riders/fleet-auth-token
accessToken: <rider loginToken>
```

Read the response from `data.fleetAuthToken` and immediately exchange it:

```http
POST https://fleet.ysz.life/api/driver-session
Content-Type: application/json

{ "token": "<data.fleetAuthToken>" }
```

Do not defer this exchange until tracking starts or location permission is
granted. Do not store or retry an old `fleetAuthToken`; its approximately
two-minute lifetime makes it a one-time bootstrap value.

The route is callable from a browser. `OPTIONS` is answered and CORS headers
are present on every response, including errors. Only `Content-Type` is on the
allowed-header list; tell Yanis before adding another request header.

Response `200`:

```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 3600,
  "expires_at": 1784732063
}
```

Pass `access_token` and `refresh_token` to the Supabase client's `setSession`
and keep Supabase session persistence enabled. Use the Supabase `access_token`
as the Bearer token for `POST /api/location`.

## Cold start and recovery

- On a normal cold start, restore the persisted Supabase session first and let
  the Supabase client refresh it. Do not call Bubble Box or Fleetmap again
  while Supabase refresh works.
- If Supabase refresh ultimately fails, use the still-valid persisted Bubble
  Box rider `loginToken` to call
  `GET /api/v2/riders/fleet-auth-token`, read
  `data.fleetAuthToken`, and repeat the exchange. This does **not** require an
  interactive login.
- Ask the rider to log in again only when the Bubble Box rider access token can
  no longer mint a fresh `fleetAuthToken`.

Do not re-exchange per request, per trip, or per shift.

## Errors

| Status | Meaning | App behavior |
|---|---|---|
| `401 { "error": "invalid token" }` | The `fleetAuthToken` is expired, invalid, or carries no rider identity. Expiry is the common case because it lives approximately two minutes | Use the rider access token to acquire a new `fleetAuthToken`, then retry once. Never retry the same `fleetAuthToken`; fall back to interactive rider login only if reacquisition fails because the rider access token is no longer valid |
| `403 { "error": "no vehicle mapped for this rider" }` | This rider has no van in Fleetmap yet | Show nothing / skip tracking; this is an operations task, not an app error |
| `400` | Malformed request | Bug; check the body shape |
| `500 { "error": "exchange failed" }` | Something broke on the Fleetmap side, including reaching Bubble Box to verify the token | Retry with bounded backoff. Do **not** send the driver to a login screen; the token is not the problem |

`401` and `500` are deliberately distinct: "the rider token was rejected" and
"the integration is unavailable" require opposite app behavior.

## The three app constants

Fleetmap moved off managed Supabase onto its own server. All three constants
are safe to keep in the app bundle: the publishable key is an anon-role key,
and row-level security is the authorization boundary.

| Constant | Value |
|---|---|
| `API_BASE_URL` | `https://fleet.ysz.life` (unchanged) |
| Supabase URL | `https://sb.fleet.ysz.life` |
| Supabase publishable key | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0NTM4MjE0LCJleHAiOjIwOTk4OTgyMTR9.WNVIZcMYo01TVYVAoqUdiMaxgE43tE8apjxkasLg3oM` |

## What changes in the app

- Remove the Supabase email/password login UI and stored driver credentials.
- Point the Supabase client at the URL and publishable key above.
- After Bubble Box login, acquire `data.fleetAuthToken`, call
  `POST /api/driver-session`, and persist the returned session with
  `setSession`.
- On cold start, restore/refresh Supabase first. Reacquire and exchange only
  after terminal Supabase refresh failure.
- Keep `POST /api/location` and the rest of the GPS path unchanged.

The first valid exchange for a new rider may auto-provision the Fleetmap
identity and assign a matching unassigned vehicle. Production proof must
therefore use a controlled rider-to-vehicle mapping.
