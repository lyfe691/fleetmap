# Supabase Local Dev + VPS Self-Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dev runs against a Supabase CLI stack on the dev machine; prod runs the official self-hosted Supabase compose on the VPS behind Caddy at `sb.fleet.ysz.life`; the managed cloud project becomes rollback-only.

**Architecture:** Stage 1 adds the pinned `supabase` CLI as a dev dependency, inits `config.toml` next to the existing `supabase/migrations/`, and flips `.env` to the local stack. Stage 2 vendors the pinned upstream `docker/` compose into `supabase-docker/` (storage/imgproxy/functions removed), fronts Kong with the existing Caddy via a shared external network, applies the repo migrations over an SSH tunnel, and copies auth + public data from the cloud project.

**Tech Stack:** Supabase CLI (pnpm dev dep), supabase/postgres 17 stack, Kong, Caddy, pg_dump/psql via `postgres:17` docker image, tsx + vitest.

**Spec:** `docs/specs/2026-07-20-supabase-local-and-selfhost-design.md`

## Global Constraints

- pnpm ≥ 10 → CLI install needs `--allow-build=supabase`; all CLI calls are project-scoped: `pnpm supabase <cmd>`.
- The cloud project is NOT modified by any task. It is rollback until Yanis retires it himself.
- Stage 2 VPS/dashboard commands are executed by Yanis (paste-ready, marked **[VPS]** or **[dev]**); repo-side Stage 2 tasks are normal local work.
- No Claude co-author trailers on commits. No explanatory comments in code/config.
- Every task ends green: `pnpm exec tsc --noEmit` + `pnpm test` where code changed.
- Secret values never land in the repo — `.env*` is gitignored except `.env.example`.

---

## Stage 1 — local dev

### Task 1: Supabase CLI installed + project initialized + trimmed config

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `supabase/config.toml` (via `supabase init`, then edited)
- Create: `supabase/seed.sql`

**Interfaces:**
- Produces: `pnpm supabase <cmd>` works project-wide; `config.toml` with `project_id = "fleetmap"`, storage + edge runtime disabled.

- [ ] **Step 1: Install the CLI**

```bash
pnpm add -D supabase --allow-build=supabase
pnpm supabase --version
```
Expected: a version ≥ 2.x prints.

- [ ] **Step 2: Init (keeps existing migrations)**

```bash
pnpm supabase init
```
Expected: `Finished supabase init.` — creates `supabase/config.toml`; `supabase/migrations/0001…0014` untouched.

- [ ] **Step 3: Trim config.toml**

In `supabase/config.toml` set (leave everything else at generated defaults):

```toml
project_id = "fleetmap"

[storage]
enabled = false

[edge_runtime]
enabled = false
```

- [ ] **Step 4: Seed file**

Create `supabase/seed.sql`:

```sql
-- schema comes from migrations; identities/demo data from scripts/provision-* and seed-stops
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml supabase/config.toml supabase/seed.sql
git commit -m "chore(supabase): CLI as dev dep + local project config"
```

### Task 2: Local stack runs all 14 migrations

**Files:** none (runtime verification only)

**Interfaces:**
- Produces: local API `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `sb_publishable_…`/`sb_secret_…` keys printed by `supabase start` (consumed by Task 3).

- [ ] **Step 1: Start (first run pulls images — minutes)**

```bash
pnpm supabase start
```
Expected: credentials box with Project URL `http://127.0.0.1:54321` + publishable/secret keys. Record both keys.

- [ ] **Step 2: Apply migrations from zero**

```bash
pnpm supabase db reset
```
Expected: `Applying migration 0001_init.sql` … `0014_vehicle_positions_created_at_idx.sql`, then seed. No errors.

- [ ] **Step 3: Verify pg_cron retention job exists (0012)**

```bash
docker exec supabase_db_fleetmap psql -U postgres -d postgres -tc "select count(*) from cron.job"
```
Expected: `1`.

- [ ] **Step 4: Verify realtime publication (0002/0004)**

```bash
docker exec supabase_db_fleetmap psql -U postgres -d postgres -tc "select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1"
```
Expected: includes `stops` and `vehicles`.

### Task 3: `.env` flipped to local; cloud values parked; identities provisioned

**Files:**
- Modify: `.env` (not committed)
- Create: `.env.cloud` (not committed — parked cloud values for Stage 2)

**Interfaces:**
- Consumes: keys from Task 2 output.
- Produces: `.env.cloud` holding `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` of the cloud project (Task 10 reads it).

- [ ] **Step 1: Park cloud values**

Copy the three current Supabase lines from `.env` into `.env.cloud` verbatim.

- [ ] **Step 2: Flip `.env`**

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_… from Task 2>
SUPABASE_SECRET_KEY=<sb_secret_… from Task 2>
```
All other `.env` values (dashboard/dispatcher/test-driver creds, OSRM, BB_*) stay unchanged.

- [ ] **Step 3: Provision identities against local**

```bash
pnpm provision-dashboard && pnpm provision-dispatcher && pnpm provision-driver
```
Expected: each logs its ensured user; no errors.

### Task 4: Full local loop proven

**Files:** none (runtime verification)

- [ ] **Step 1: Dev server + seed + fake feed**

```bash
pnpm dev        # background
pnpm seed-stops
pnpm fake-gps   # background, let it run during checks
```
Expected: seed-stops logs created orders/stops per city; fake-gps posts 200s.

- [ ] **Step 2: Health + data checks**

```bash
curl -s http://localhost:3000/api/health
```
Expected: `"supabase":"ok"` (osrm may be down if the dev OSRM container isn't running — fine for this task).

```bash
curl -s "http://127.0.0.1:54321/rest/v1/vehicles_public?select=id,label,last_lat" -H "apikey: <sb_publishable_…>" -H "Authorization: Bearer <dashboard session token — skip if fiddly and rely on the dashboard check below>"
```
Alternative simple check: `docker exec supabase_db_fleetmap psql -U postgres -d postgres -tc "select count(*) from vehicles where last_lat is not null"` — expected > 0 after a minute of fake-gps.

- [ ] **Step 3: M15 fixture E2E against local**

```bash
docker exec supabase_db_fleetmap psql -U postgres -d postgres -c "update vehicles set rider_ref='rider-1' where label='Test Van'"
BB_FIXTURE_FILE=workers/dev-fixture.json pnpm bb-sync   # one tick, then Ctrl-C / kill
docker exec supabase_db_fleetmap psql -U postgres -d postgres -tc "select count(*) from stops s join vehicles v on v.id=s.vehicle_id where v.rider_ref='rider-1'"
```
Expected: stop count matches the fixture's points (rider_ref value must match the fixture's rider id — check `workers/dev-fixture.json` first and use its id).

- [ ] **Step 4: TV eyeball (Yanis)**

Open `http://localhost:3000/dashboard`, enter the display code: markers move live, History replays today. (Realtime through the local stack is the thing being proven.)

- [ ] **Step 5: Suite green**

```bash
pnpm exec tsc --noEmit && pnpm test
```
Expected: both pass (no code changed — this is a regression gate).

### Task 5: Docs match the local-first workflow

**Files:**
- Modify: `CLAUDE.md` (Stack bullet, Setup, Commands, fake-gps demo note)
- Modify: `.env.example`

- [ ] **Step 1: CLAUDE.md**

Stack bullet: Supabase line gains "— local CLI stack for dev (`pnpm supabase start`); prod self-hosts on the VPS (Stage 2, spec 2026-07-20)". Commands block gains:

```
pnpm supabase start               # local Supabase stack (Docker)
pnpm supabase stop                # stop it (state survives)
pnpm supabase db reset            # re-apply all migrations + seed
```

Setup section: replace "apply 0001 to the cloud project" with the local flow (init already committed; `start` + `db reset` + provision scripts). fake-gps-against-prod note: secret key for prod is passed inline, never stored in `.env`.

- [ ] **Step 2: .env.example**

Header rewritten: default values point at the local stack (`http://127.0.0.1:54321`, keys from `supabase start` output); cloud/VPS values live on the VPS only.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: local-first Supabase workflow (Stage 1)"
```

---

## Stage 2 — VPS self-host

### Task 6: Self-host key generator (TDD)

**Files:**
- Create: `scripts/gen-selfhost-keys.ts`
- Test: `scripts/gen-selfhost-keys.test.ts`

**Interfaces:**
- Produces: `generateKeys(secret?) -> { jwtSecret, anonKey, serviceRoleKey }`; CLI: `pnpm tsx scripts/gen-selfhost-keys.ts` prints JSON (consumed in Task 9 to fill the VPS env).

- [ ] **Step 1: Failing test**

`scripts/gen-selfhost-keys.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createHmac } from "node:crypto"
import { generateKeys, signJwt } from "./gen-selfhost-keys"

const decode = (jwt: string) => {
  const [h, p, s] = jwt.split(".")
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    payload: JSON.parse(Buffer.from(p, "base64url").toString()),
    resign: createHmac("sha256", "test-secret").update(`${h}.${p}`).digest("base64url") === s,
  }
}

describe("gen-selfhost-keys", () => {
  it("signs HS256 JWTs verifiable with the secret", () => {
    const jwt = signJwt({ role: "anon", iss: "supabase" }, "test-secret")
    const d = decode(jwt)
    expect(d.header).toEqual({ alg: "HS256", typ: "JWT" })
    expect(d.payload.role).toBe("anon")
    expect(d.resign).toBe(true)
  })

  it("generates anon + service_role keys off one secret", () => {
    const keys = generateKeys("test-secret")
    expect(keys.jwtSecret).toBe("test-secret")
    expect(decode(keys.anonKey).payload.role).toBe("anon")
    expect(decode(keys.serviceRoleKey).payload.role).toBe("service_role")
    expect(decode(keys.anonKey).payload.exp - decode(keys.anonKey).payload.iat).toBe(315360000)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm test gen-selfhost-keys`) with module-not-found.

- [ ] **Step 3: Implement**

`scripts/gen-selfhost-keys.ts`:

```ts
import { createHmac, randomBytes } from "node:crypto"

const b64u = (v: string) => Buffer.from(v).toString("base64url")

export function signJwt(payload: object, secret: string): string {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64u(JSON.stringify(payload))
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")
  return `${head}.${body}.${sig}`
}

export function generateKeys(secret: string = randomBytes(32).toString("hex")) {
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + 315360000
  const mint = (role: string) => signJwt({ role, iss: "supabase", iat, exp }, secret)
  return { jwtSecret: secret, anonKey: mint("anon"), serviceRoleKey: mint("service_role") }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("gen-selfhost-keys.ts")) {
  console.log(JSON.stringify(generateKeys(process.env.JWT_SECRET || undefined), null, 2))
}
```

- [ ] **Step 4: Run — expect PASS**, then `pnpm exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-selfhost-keys.ts scripts/gen-selfhost-keys.test.ts
git commit -m "feat(selfhost): HS256 key generator for the supabase stack"
```

### Task 7: Vendored, trimmed supabase-docker/ stack

**Files:**
- Create: `supabase-docker/` — upstream `supabase/supabase` `docker/` dir at a pinned commit, then trimmed
- Create: `supabase-docker/.env.example`

**Interfaces:**
- Produces: `docker compose` project named `supabase` with services db, kong, auth, rest, realtime, meta, studio, supavisor; kong joins external network `fleetmap-edge`; host ports bound to 127.0.0.1 only. Consumed by Tasks 8–11.

- [ ] **Step 1: Fetch pinned upstream**

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase /tmp/sb && git -C /tmp/sb sparse-checkout set docker && git -C /tmp/sb rev-parse HEAD   # record this SHA
cp -r /tmp/sb/docker supabase-docker
```
Record the SHA in `supabase-docker/UPSTREAM` (one line: `supabase/supabase@<sha> docker/`).

- [ ] **Step 2: Trim compose**

In `supabase-docker/docker-compose.yml`: delete services `storage`, `imgproxy`, `functions`; delete the `deno-cache` volume; remove `storage`/`imgproxy` from any `depends_on`. In `supabase-docker/volumes/api/kong.yml`: delete the `storage-v1` and `functions-v1` routes/services blocks. Delete `supabase-docker/volumes/functions/` and `supabase-docker/volumes/storage/` if present.

- [ ] **Step 3: Bind ports to loopback + edge network**

In `docker-compose.yml`: kong ports → `127.0.0.1:${KONG_HTTP_PORT}:8000` (drop the 8443 mapping — TLS is Caddy's); supavisor ports → `127.0.0.1:${POSTGRES_PORT}:5432` and `127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543`. Add:

```yaml
  kong:
    networks:
      default: {}
      fleetmap-edge: {}
```
and at file bottom:
```yaml
networks:
  fleetmap-edge:
    external: true
```

- [ ] **Step 4: Write `supabase-docker/.env.example`**

```dotenv
POSTGRES_PASSWORD=
JWT_SECRET=
ANON_KEY=
SERVICE_ROLE_KEY=
# ^ all four from: pnpm tsx scripts/gen-selfhost-keys.ts

DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=
SECRET_KEY_BASE=
VAULT_ENC_KEY=
PG_META_CRYPTO_KEY=

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
KONG_HTTP_PORT=8000
POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_TENANT_ID=fleetmap
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_DB_POOL_SIZE=10

SITE_URL=https://fleet.ysz.life
API_EXTERNAL_URL=https://sb.fleet.ysz.life
SUPABASE_PUBLIC_URL=https://sb.fleet.ysz.life
ADDITIONAL_REDIRECT_URLS=
JWT_EXPIRY=3600
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=true
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
MAILER_URLPATHS_INVITE=/auth/v1/verify
MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
MAILER_URLPATHS_RECOVERY=/auth/v1/verify
MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify
SMTP_ADMIN_EMAIL=admin@fleet.ysz.life
SMTP_HOST=localhost
SMTP_PORT=2500
SMTP_USER=unused
SMTP_PASS=unused
SMTP_SENDER_NAME=Fleetmap

STUDIO_DEFAULT_ORGANIZATION=Fleetmap
STUDIO_DEFAULT_PROJECT=Fleetmap
PGRST_DB_SCHEMAS=public,graphql_public
PGRST_DB_MAX_ROWS=1000
PGRST_DB_EXTRA_SEARCH_PATH=public
FUNCTIONS_VERIFY_JWT=false
IMGPROXY_AUTO_WEBP=true
OPENAI_API_KEY=
```
Trim any variables the trimmed compose no longer references; keep any it still does (`docker compose config` in Task 9 is the arbiter).

- [ ] **Step 5: Validate compose parses (no containers started locally)**

```bash
cd supabase-docker && cp .env.example .env && docker compose config >/dev/null && rm .env && cd ..
```
Expected: exit 0, no undefined-variable warnings.

- [ ] **Step 6: Commit**

```bash
git add supabase-docker
git commit -m "feat(selfhost): vendored supabase compose stack (pinned, trimmed)"
```

### Task 8: Caddy + prod compose wiring

**Files:**
- Modify: `caddy/Caddyfile`
- Modify: `docker-compose.prod.yml` (caddy service networks)

**Interfaces:**
- Consumes: `fleetmap-edge` external network + `kong` service name from Task 7.
- Produces: `https://sb.fleet.ysz.life` → Kong.

- [ ] **Step 1: Caddyfile — add below the existing site**

```
sb.fleet.ysz.life {
	reverse_proxy kong:8000
}
```

- [ ] **Step 2: docker-compose.prod.yml — caddy joins the edge network**

```yaml
  caddy:
    networks:
      - default
      - fleetmap-edge
```
and at file bottom:
```yaml
networks:
  fleetmap-edge:
    external: true
```

- [ ] **Step 3: Commit**

```bash
git add caddy/Caddyfile docker-compose.prod.yml
git commit -m "feat(selfhost): caddy fronts kong on sb.fleet.ysz.life"
```

### Task 9: VPS bring-up (paste-ready for Yanis)

**Files:** none (VPS runtime) — steps land in `docs/deployment.md` in Task 11.

- [ ] **Step 1 [dashboard]:** DNS `A` record `sb.fleet.ysz.life` → the VPS IP. Verify: `dig +short sb.fleet.ysz.life`.

- [ ] **Step 2 [dev]:** generate secrets — `pnpm tsx scripts/gen-selfhost-keys.ts` (keep the JSON); plus `openssl rand -hex 32` three times for `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, and a strong `POSTGRES_PASSWORD` + `DASHBOARD_PASSWORD`.

- [ ] **Step 3 [VPS]:**

```bash
cd /opt/fleetmap && git pull
docker network create fleetmap-edge
cd supabase-docker && cp .env.example .env && nano .env   # paste Step-2 values
docker compose up -d
docker compose ps   # all healthy (studio can take ~30s)
```

- [ ] **Step 4 [VPS]: restart Caddy on the new network + smoke**

```bash
cd /opt/fleetmap && docker compose -f docker-compose.prod.yml up -d caddy
curl -s https://sb.fleet.ysz.life/auth/v1/health
```
Expected: `{"version":…,"name":"GoTrue"…}` over valid TLS. Also `curl -s -H "apikey: <ANON_KEY>" https://sb.fleet.ysz.life/rest/v1/` returns OpenAPI JSON.

### Task 10: Schema + data migration (dev machine over SSH tunnel)

**Files:** none (runtime); `.env.cloud` from Task 3 supplies cloud values; cloud DB password from the dashboard.

- [ ] **Step 1 [dev]: tunnel**

```bash
ssh -N -L 6544:127.0.0.1:5432 root@fleet.ysz.life   # leave running
```

- [ ] **Step 2 [dev]: apply migrations (repo = schema authority)**

```bash
pnpm supabase db push --db-url "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:6544/postgres"
```
Expected: lists 0001…0014, `Finished supabase db push.`

- [ ] **Step 3 [dev]: dump from cloud** (session-pooler URL from the dashboard: Connect → Session pooler)

```bash
docker run --rm postgres:17 pg_dump "<CLOUD_SESSION_POOLER_URL>" --data-only --column-inserts -t auth.users -t auth.identities > auth-data.sql
docker run --rm postgres:17 pg_dump "<CLOUD_SESSION_POOLER_URL>" --data-only -t public.operational_areas -t public.vehicles -t public.orders -t public.stops -t public.vehicle_positions -t public.sync_state > public-data.sql
```

- [ ] **Step 4 [dev]: restore into the VPS db**

```bash
docker run --rm -i --network host postgres:17 psql "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:6544/postgres" -v ON_ERROR_STOP=1 -c "set session_replication_role = replica" -f - < auth-data.sql
docker run --rm -i --network host postgres:17 psql "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:6544/postgres" -v ON_ERROR_STOP=1 -c "set session_replication_role = replica" -f - < public-data.sql
```
(On Windows, run these two from Git Bash; `--network host` works because the tunnel listens on the host.)

- [ ] **Step 5 [dev]: fix the identity sequence + spot-check**

```bash
docker run --rm --network host postgres:17 psql "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:6544/postgres" -tc "select setval(pg_get_serial_sequence('vehicle_positions','id'), coalesce(max(id),1)) from vehicle_positions; select (select count(*) from auth.users), (select count(*) from vehicles), (select count(*) from stops)"
```
Expected: counts match the cloud project (compare in Studio / cloud dashboard). Delete `auth-data.sql` + `public-data.sql` afterwards.

### Task 11: Cutover, backups, docs

**Files:**
- Modify: `docs/deployment.md` (self-host section replaces "Supabase stays managed")
- Modify: `CLAUDE.md` (stack bullet: prod = self-hosted on VPS)
- Create: `supabase-docker/backup.sh`

- [ ] **Step 1 [VPS]: flip the app**

Edit `/opt/fleetmap/.env`: `NEXT_PUBLIC_SUPABASE_URL=https://sb.fleet.ysz.life`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ANON_KEY>`. Then:

```bash
cd /opt/fleetmap && docker compose -f docker-compose.prod.yml up -d --build app sync
curl -s https://fleet.ysz.life/api/health
```
Expected: `"supabase":"ok"`. TV re-enters the display code; dashboard loads; History works.

- [ ] **Step 2 [dev]: live-fire check** — brief `FAKE_GPS_API_URL=https://fleet.ysz.life/api/location SUPABASE_SECRET_KEY=<SERVICE_ROLE_KEY> NEXT_PUBLIC_SUPABASE_URL=https://sb.fleet.ysz.life pnpm fake-gps` run: marker moves on the office TV via self-hosted Realtime. Stop it after.

- [ ] **Step 3: Roman message** — draft for Yanis to send (house style: no em dashes, short, colleague tone, asks not orders): new Supabase URL `https://sb.fleet.ysz.life` + new publishable key; logins unchanged (passwords survived the move); API_BASE_URL unchanged.

- [ ] **Step 4: backups**

`supabase-docker/backup.sh`:

```bash
#!/bin/sh
set -eu
mkdir -p /opt/fleetmap-backups
docker compose -f /opt/fleetmap/supabase-docker/docker-compose.yml exec -T db pg_dump -U postgres postgres | gzip > "/opt/fleetmap-backups/fleetmap-$(date +%F).sql.gz"
find /opt/fleetmap-backups -name 'fleetmap-*.sql.gz' -mtime +14 -delete
```

[VPS]: `chmod +x supabase-docker/backup.sh` and `crontab -e` → `10 2 * * * /opt/fleetmap/supabase-docker/backup.sh`.

- [ ] **Step 5: docs + commit**

`docs/deployment.md`: replace the managed-cloud framing with the two-stack shape (app stack + supabase stack, shared `fleetmap-edge`, bring-up = Tasks 9–11 distilled, backup cron, rollback = flip `.env` back + rebuild while the cloud project lives). `CLAUDE.md` stack bullet updated.

```bash
git add supabase-docker/backup.sh docs/deployment.md CLAUDE.md
git commit -m "docs(selfhost): deployment guide for the VPS supabase stack"
```

- [ ] **Step 6: soak** — cloud project stays untouched until Yanis declares done (his call, out of plan scope).
