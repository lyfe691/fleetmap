# Next steps (2026-07-27)

Copy-paste file. Untracked on purpose, delete when done.
Supersedes the 2026-07-22 version, which understated prod.

## Where things actually stand

Probed from outside on 2026-07-27, not read from notes:

| Check | Result | Means |
|---|---|---|
| `/api/health` | `{"ok":true,"supabase":"ok","osrm":"ok","sync":null}` | app + Supabase + OSRM green; sync dormant (no BB env yet, correct) |
| `/dispatch`, `PATCH /api/stops/:id` | 404 | the 07-22 images **were** shipped, prod runs M18 + M19 |
| `select address from stops` | `42703 does not exist` | migration **0016 is applied** |
| `POST /api/driver-session` | 404 | **M20 is not deployed** (box's git is behind `113611a`) |
| local `main` | tsc clean, 120/120 tests | nothing half-finished |

So the only undeployed work is the driver auth exchange, and the only real
blocker is that two messages were never sent.

---

## 1. Send these two, today — BOTH SENT 2026-07-27

Awaiting: Dmytro (prod fleet API go-live, and the token verification endpoint
he proposed on 07-27) and Roman (one release once that exists). Kept below for
reference on what was actually asked.

### Dmytro (continues the thread)

```
Hi Dmytro! Sorry for the silence, I was out sick for a few days.

Two things from my side.

Go live: when do you think the fleet API could run on the production server? And whatever login you create for me there, a stronger password than the staging one would be good.

Second thing. I'm removing the second login for the riders in the tracking app. Instead of logging in again, the app will exchange the Bubble Box token it already holds for a tracking session on my side. To verify those tokens I need two things from you: the public key your JWTs are signed with (the RS256 key as PEM, or a JWKS URL if you have one), and one example of the token payload a rider gets when they log in. Same as what I get from the fleet authentication endpoint, but for a rider account. I just need to see where the rider id sits in it. As far as I can tell nothing needs building on your side, your existing tokens should be enough.
```

### Roman

Continues the thread: he already has the URL + key, offered to update right
away, and was told "you can do it later". So this picks that back up rather
than introducing the change.

```
Good thing you waited with that update. The two constants still apply, but there is now a nicer way that also removes the second login for the drivers completely.

Instead of logging in to the tracking separately, your app can exchange the Bubble Box token it already holds for a tracking session with one POST call. Drivers then only ever log in to Bubble Box, and tracking passwords stop existing. New riders get set up automatically on their first login, so nobody has to create accounts for them.

I wrote the whole thing up, sending it along. The URL and key from before are in the same document, so one release covers everything.

Could you have a look and tell me if that fits your app? One thing on timing: the endpoint is not live yet, I need one detail from Dmytro first. I will let you know the moment it is, better not to ship before then.
```

Then send him `docs/driver-session-api.md` (paste it or share the file). It
now carries the three app constants inline, so it is the whole handoff.

**Do not let him ship before Dmytro's key is in prod.** The exchange would
401 every driver, which is worse than the two logins they have today.

---

## 2. Deploy M20 — DONE 2026-07-27

Shipped, live, and proven in prod: the endpoint answers 401/400/405, and a
stand-in-signed token ran the whole success path (session minted, driver
auto-provisioned, van claimed, GPS written through RLS) with the test data
removed afterwards. Two deploy bugs were found and fixed on the way — the
workers had never started (`pnpm exec` on boot) and Caddy was serving stale
config through a single-file bind mount. Both fixed in `redeploy.sh` /
`docker-compose.prod.yml`.

Original instructions kept below for the next time this runs.

### (historical) Deploy M20

The images are rebuilt (all three, including the new `fleetmap-driver-session`
target). Three steps, in this order.

**a. Create the env file on the VPS. This comes first.** `env_file` is
mandatory in compose, so if `.env.driver-session` is missing when the box
pulls the new compose file, `docker compose up` aborts the **whole stack**.
This is the only way this deploy can take prod down.

```bash
ssh root@fleet.ysz.life
cd /opt/fleetmap
{ grep -m1 '^SERVICE_ROLE_KEY=' supabase-docker/.env | sed 's/^SERVICE_ROLE_KEY=/SUPABASE_SECRET_KEY=/'
  echo 'BB_DRIVER_JWT_PUBLIC_KEY_B64=LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF6TXJtb1RHWFFaeEgvTll6dUVQOApuRkloTDRXM2ZTT2VtRkFYZDg5cW8rWE9sdEwxMUFqNXRYK2l0bVlFWitWRS9wUzk4bEx3L2xvN2ZPUmNWWXVWClNyOUM4cVY2L1d0QklKL2VVRi9lVE10U1BDd1E0dUR2RnU4a2Jzb3UyK1NXcGxzQzY4WW1WRG9QQlVUSjQwaHkKZ0duTUc0QkZCQmFhM2JhaEJWQTA3UXZZWlRvRnZoTHN3QkpRaENZRUZnbFJiQkpjTHRFNGZnajJRT0toakNRdgo5WUhsYnR2UlBnZmxsazVIWVJjTEpFby9wWUpNUXlTcjAycVF4UEtDUGJxaEVPVllSbkhQSkt0MTRWTDM4RkpaCndicjJ1S3NBS1hHbUdwcXFjNVpoa2laU0U0M0xaN2lXdGpQdFRLWFZmdGhYWGdBS1p0dmZZNXljWDVsMVRWNDUKTndJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0t'
} > .env.driver-session
chmod 600 .env.driver-session
cat .env.driver-session   # sanity: two lines, both non-empty
exit
```

That key is the **dev stand-in**, deliberately. It gets the service running and
provable now; Dmytro's real key replaces it later with an edit and a restart,
no rebuild (the key is runtime env, not a build arg).

**b. Ship and redeploy** (from the repo root on this machine). The tar is
99MB, not the 374MB it used to be — the workers are now bundled instead of
carrying a 1.1GB `node_modules` each:

```bash
scp fleetmap-images.tar.gz root@fleet.ysz.life:/opt/fleetmap/
ssh root@fleet.ysz.life "cd /opt/fleetmap && ./redeploy.sh"
```

**c. Verify:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://fleet.ysz.life/api/driver-session \
  -H 'Content-Type: application/json' -d '{"token":"not-a-jwt"}'
# expect 401. A 404 means Caddy never got the route (git pull did not take).

curl -s https://fleet.ysz.life/api/health
# expect {"ok":true,"supabase":"ok","osrm":"ok","sync":null}

ssh root@fleet.ysz.life "cd /opt/fleetmap && docker compose -f docker-compose.prod.yml logs --tail=5 sync"
# expect the worker's own "Missing env" line, NOT a pnpm stack trace (see below)
```

Both worker containers were then run against the local stack from the shipped
images, so this is not a "should work" ship:

| Proof | Result |
|---|---|
| driver-session, existing driver (rider 6) | `200`, session minted |
| driver-session, unassigned van (rider 77) | `200`, auto-provisioned then minted |
| driver-session, fleet token | `401` |
| driver-session, rider with no van | `403` |
| **minted token → `POST /api/location`** | **`200 {"ok":true}`** — the session really passes RLS |
| sync, fixture mode | 3 stops written onto the mapped van |
| sync, live staging | token minted, 2 clean ticks, heartbeat `fresh: true` |

> **Bug found and fixed while building these images.** Both workers ran
> `pnpm exec tsx …`, and `pnpm exec` re-checks dependencies on every start;
> that check reinstalls without `pnpm-workspace.yaml`'s `allowBuilds` and
> exits 1. Neither worker container has ever actually started. It stayed
> invisible because `sync` is *meant* to exit on boot until `BB_*` is set, so
> a crash loop looked normal. It would have surfaced at go-live and looked
> like Dmytro's API was broken. Both now call `./node_modules/.bin/tsx`
> directly; the images in your tar are the fixed ones.

If `redeploy.sh` fails on the env file, `.env.driver-session` is missing or
malformed. Fix it and rerun, nothing is lost.

---

## 3. When Dmytro answers

Two separate tracks. Orders do not wait on login.

**Login track** (superseded design, agreed 2026-07-27 — see the spec's
2026-07-27 section). Two of the three unknowns are already answered: the
endpoint is `/fleet/verify-token`, its rider id is the same value as
`/fleet/rider-routes` (so `rider_ref` is untouched), and it authenticates with
the `/fleet/authentication-token` token the sync already mints (no new
credentials). Only the request/response shape is still open.

- His verification endpoint spec → Claude rewrites `lib/driver-auth/verify.ts`
  to call it instead of checking a signature, swaps `.env.driver-session` from
  the public key to that endpoint's URL + credentials, ships a new
  driver-session image, and re-proves the prod path exactly as on 07-27.
- Then one line changes in `docs/driver-session-api.md` (which token Roman
  sends), and Roman ships.
- Dead: the public key and rider-token sample. Not needed under this design.

**Orders track:**
- Prod fleet API creds → `BB_API_URL` + `BB_API_USERNAME` + `BB_API_PASSWORD`
  into `/opt/fleetmap/.env`, restart `sync`, watch `/api/health` until `sync`
  stops being null.
- **Provision the fleet:** one `vehicles` row per rider in his prod feed, with
  `rider_ref` set to that rider's id. Read the ids off the prod feed itself —
  they are per-database, so staging's numbers do not carry over. Driver users
  auto-provision on first login, no passwords anywhere.
  If two riders in that list look like the same physical van, ask him then;
  `rider_ref` is one rider per vehicle, so a van split across two rider ids
  would only show half its stops.

---

## 4. After the first proven live day

- [x] ~~Decide the placeholder telematics panels~~ — settled long ago: dropped,
      not deferred. The fabricated panels were deleted 2026-07-13; `assumed.ts`
      holds only the `"Depot"` label. Do not resurrect.
- [ ] Retire the old managed-cloud Supabase project (still alive as rollback).
- [ ] Delete `purge-prod-demo.ps1` / `probe-prod-driver.ps1` if still around.
- [ ] Local: `update vehicles set rider_ref = null where label = 'Test Van';`
      and `pnpm seed-stops` if you want the demo fleet back.

---

## Answered earlier, for reference

Dmytro, 2026-07-22: `actualFulfillmentTime` is set by the rider's "done"
button, so the completion rule is the intended signal; `rider.id` is a DB id
and never changes; the null-coordinate points were staging test artifacts and
he fixed them the same day.
