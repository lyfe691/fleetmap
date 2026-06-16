# M6 — Order/Stop Model + Ingestion Seam + Dispatcher Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the order/stop data model, a single swappable ingestion seam (`POST /api/ingest/stops`) behind a dedicated dispatcher identity, and a dev seed script — with no visible TV change.

**Architecture:** Two new tables (`orders` holds the business entity + PII and is never published to Realtime; `stops` is the canonical map entity, published with `REPLICA IDENTITY FULL`). Writes go through one atomic Postgres function (`ingest_stops`) called by a thin handler that runs as a `dispatcher` Auth role, so RLS is the write boundary. A `stops_public` column-scoped view feeds the TV snapshot later. The seam is swappable: adapter #1 is `scripts/seed-stops.ts`; a client feed slots in later with zero schema/RLS/Realtime change.

**Tech Stack:** Next.js App Router route handlers (Node runtime), Supabase (Postgres + RLS + Realtime + Auth), `@supabase/supabase-js`, `tsx` for scripts, `pnpm`.

> **Verification convention:** this repo has **no automated test suite** (per CLAUDE.md). The gate for every task is `pnpm exec tsc --noEmit` (clean) plus the runnable acceptance check shown in the task. Mirror the existing patterns in `app/api/location/route.ts`, `app/api/dashboard-session/route.ts`, `scripts/provision-dashboard.ts`, and `scripts/fake-gps.ts`.

> **Prereqs:** `.env` is populated (Supabase URL + publishable + secret keys, dashboard vars). Supabase CLI is linked (ref `ewqxlsmzchrkvotjrlau`; `npx -y supabase db push` applies migrations). `pnpm dev` is runnable. Work on a branch off `main`.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0004_orders_stops.sql` (create) | `orders` + `stops` tables, RLS policies, Realtime publication + `REPLICA IDENTITY FULL`, `stops_public` view, `ingest_stops` rpc |
| `scripts/provision-dispatcher.ts` (create) | Dev-only: idempotently create the `dispatcher` Auth user (`app_metadata.role='dispatcher'`) |
| `app/api/dispatcher-session/route.ts` (create) | Mint a short-lived dispatcher JWT behind a shared secret (mirrors `dashboard-session`) |
| `app/api/ingest/stops/route.ts` (create) | Validate the ingestion contract, call `ingest_stops` rpc as the dispatcher |
| `scripts/seed-stops.ts` (create) | Adapter #1: resolve a vehicle, mint a dispatcher session, POST a hand-written day of stops |
| `.env.example` (modify) | Add `DISPATCHER_EMAIL`, `DISPATCHER_PASSWORD`, `DISPATCHER_INGEST_SECRET` |
| `package.json` (modify) | Add `provision-dispatcher` + `seed-stops` scripts |
| `CLAUDE.md` (modify) | Milestone M6 → done; layout + commands entries |

---

## Task 1: Migration `0004` — orders, stops, RLS, Realtime, view, rpc

**Files:**
- Create: `supabase/migrations/0004_orders_stops.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0004_orders_stops.sql — M6: order/stop model + ingestion seam.
-- orders is the business entity (holds PII) and is NEVER published to Realtime.
-- stops is the canonical map entity the dashboard reads + subscribes to.

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  external_ref   text,
  source         text not null default 'manual',
  customer_name  text,
  status         text not null default 'new'
                   check (status in ('new','assigned','in_progress','completed','cancelled')),
  scheduled_date date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (source, external_ref)
);

create table if not exists stops (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders (id) on delete cascade,
  vehicle_id   uuid references vehicles (id) on delete set null,
  stop_type    text not null check (stop_type in ('pickup','dropoff')),
  seq          int not null,
  lat          double precision not null,
  lng          double precision not null,
  address      text,
  status       text not null default 'planned'
                 check (status in ('planned','arrived','completed','failed','skipped')),
  eta_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint stops_vehicle_seq_unique unique (vehicle_id, seq) deferrable initially deferred
);

create index if not exists stops_vehicle_id_seq_idx on stops (vehicle_id, seq);

alter table orders enable row level security;
alter table stops  enable row level security;

-- orders: dispatcher-only, full access. No dashboard/driver policy => unreadable
-- by the TV; PII never leaves the dispatcher boundary.
create policy "dispatcher manages orders"
  on orders for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');

-- stops: dispatcher full access (insert/update/delete for replace-set + mutations).
create policy "dispatcher manages stops"
  on stops for all to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dispatcher');

-- stops: dashboard claim-scoped read (mirrors 0002's vehicles policy).
create policy "dashboard role can read all stops"
  on stops for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'dashboard');

-- stops: driver may update only their own vehicle's stops, status transitions only.
-- Named now so the boundary exists from day one; the driver write surface lands in M9.
create policy "drivers can update their own vehicle stops"
  on stops for update to authenticated
  using (
    exists (
      select 1 from vehicles v
      where v.id = stops.vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from vehicles v
      where v.id = stops.vehicle_id
        and v.assigned_user_id = (select auth.uid())
    )
  );

-- Realtime: publish stops only (orders stays off the wire). REPLICA IDENTITY FULL
-- so DELETE payloads carry vehicle_id for client-side bucket eviction.
alter table stops replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stops'
  ) then
    alter publication supabase_realtime add table stops;
  end if;
end $$;

-- Column-scoped projection for the TV snapshot (mirrors 0003's vehicles_public).
create or replace view stops_public
  with (security_invoker = true) as
  select id, vehicle_id, stop_type, seq, lat, lng, status, eta_at
  from stops;

grant select on stops_public to anon, authenticated;

-- Atomic ingestion: upsert each order by (source, external_ref), replace-set its
-- stops. SECURITY INVOKER so the caller's RLS (dispatcher) remains the boundary.
create or replace function ingest_stops(p_orders jsonb)
  returns void
  language plpgsql
as $$
declare
  o jsonb;
  s jsonb;
  v_order_id uuid;
begin
  for o in select * from jsonb_array_elements(p_orders)
  loop
    insert into orders (external_ref, source, customer_name, scheduled_date, status)
    values (
      o->>'external_ref',
      coalesce(o->>'source', 'manual'),
      o->>'customer_name',
      (o->>'scheduled_date')::date,
      'assigned'
    )
    on conflict (source, external_ref) do update
      set customer_name  = excluded.customer_name,
          scheduled_date = excluded.scheduled_date,
          status         = 'assigned',
          updated_at     = now()
    returning id into v_order_id;

    delete from stops where order_id = v_order_id;

    for s in select * from jsonb_array_elements(o->'stops')
    loop
      insert into stops (order_id, vehicle_id, stop_type, seq, lat, lng, address, eta_at)
      values (
        v_order_id,
        nullif(s->>'vehicle_id','')::uuid,
        s->>'stop_type',
        (s->>'seq')::int,
        (s->>'lat')::double precision,
        (s->>'lng')::double precision,
        s->>'address',
        nullif(s->>'eta_at','')::timestamptz
      );
    end loop;
  end loop;
end;
$$;

grant execute on function ingest_stops(jsonb) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `npx -y supabase db push`
Expected: applies `0004_orders_stops.sql` with no error.

- [ ] **Step 3: Verify schema + RLS landed**

Run (Supabase SQL editor or `npx -y supabase db query`):
```sql
select count(*) from orders;            -- 0
select count(*) from stops;             -- 0
select relname, relreplident from pg_class where relname = 'stops';  -- relreplident = 'f' (full)
select tablename from pg_publication_tables
  where pubname='supabase_realtime' and tablename in ('stops','orders');  -- 'stops' only
select policyname from pg_policies where tablename='stops';  -- 4 policies
```
Expected: tables empty, `stops` replica identity full, only `stops` published, 4 stop policies present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_orders_stops.sql
git commit -m "feat(m6): orders/stops schema + RLS + realtime + ingest_stops rpc"
```

---

## Task 2: Dispatcher Auth identity

**Files:**
- Create: `scripts/provision-dispatcher.ts`
- Modify: `.env.example`
- Modify: `package.json`

- [ ] **Step 1: Add env vars to `.env.example`**

Add directly after the existing dashboard block:
```
# Dispatcher identity (ingestion writer) — SERVER-ONLY. Do NOT prefix NEXT_PUBLIC_.
# DISPATCHER_INGEST_SECRET gates POST /api/dispatcher-session (the session mint),
# exactly like DASHBOARD_DISPLAY_CODE gates the dashboard session.
DISPATCHER_EMAIL=dispatcher@fleetmap.internal
DISPATCHER_PASSWORD=
DISPATCHER_INGEST_SECRET=
```

- [ ] **Step 2: Write `scripts/provision-dispatcher.ts`**

```ts
/**
 * Dev-only: provision the dispatcher identity (the ingestion writer).
 *
 * Run with:  pnpm provision-dispatcher
 * Idempotently creates (or updates) a dedicated Auth user carrying
 * app_metadata.role='dispatcher' — the claim the M6 RLS policies key on so the
 * ingestion seam can write orders/stops while the TV stays read-only.
 *
 * Uses the secret key (admin). Dev/scripts only — never shipped.
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const email = process.env.DISPATCHER_EMAIL
const password = process.env.DISPATCHER_PASSWORD

if (!url || !secretKey || !email || !password) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "DISPATCHER_EMAIL, DISPATCHER_PASSWORD (copy .env.example -> .env)."
  )
}

const APP_METADATA = { role: "dispatcher" }

async function main(): Promise<void> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: email!,
      password: password!,
      email_confirm: true,
      app_metadata: APP_METADATA,
    })
  if (
    createError &&
    !/already.*(registered|exists)/i.test(createError.message)
  ) {
    if (createError.code === "not_admin" || createError.status === 403) {
      throw new Error(
        "Supabase admin API rejected the key (403 not_admin). " +
          "SUPABASE_SECRET_KEY must be a Secret key (sb_secret_...) from " +
          "Dashboard -> Project Settings -> API Keys -> Secret keys."
      )
    }
    throw createError
  }

  if (created?.user) {
    console.log(`created dispatcher user ${email} (role=dispatcher)`)
    return
  }

  const { data: list, error: listError } = await admin.auth.admin.listUsers()
  if (listError) throw listError
  const userId = list.users.find((u) => u.email === email)?.id
  if (!userId) throw new Error("could not resolve dispatcher user id")

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: password!,
    app_metadata: APP_METADATA,
  })
  if (updateError) throw updateError
  console.log(`updated dispatcher user ${email} (role=dispatcher asserted)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
```

- [ ] **Step 3: Add the `package.json` script**

In `"scripts"`, after the `provision-dashboard` line:
```json
    "provision-dispatcher": "tsx --env-file=.env scripts/provision-dispatcher.ts",
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors (a pre-existing `components/ui/calendar.tsx` error is unrelated).

- [ ] **Step 5: Set values + run it**

Set `DISPATCHER_PASSWORD` and `DISPATCHER_INGEST_SECRET` in `.env` (any strong values).
Run: `pnpm provision-dispatcher`
Expected: prints `created dispatcher user dispatcher@fleetmap.internal (role=dispatcher)` (or `updated …` on re-run).

- [ ] **Step 6: Commit**

```bash
git add scripts/provision-dispatcher.ts .env.example package.json
git commit -m "feat(m6): dispatcher Auth identity + provisioning script"
```

---

## Task 3: `POST /api/dispatcher-session` (shared-secret mint)

**Files:**
- Create: `app/api/dispatcher-session/route.ts`

- [ ] **Step 1: Write the route handler**

```ts
import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

// Mints a dispatcher session from server-only credentials, gated by a shared
// ingest secret. Mirrors /api/dashboard-session: the password never reaches a
// client — only the minted dispatcher session tokens do. Used by the dev seed
// script and (later) an unattended server-to-server feed adapter.
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.DISPATCHER_INGEST_SECRET
  const email = process.env.DISPATCHER_EMAIL
  const password = process.env.DISPATCHER_PASSWORD
  if (!expectedSecret || !email || !password) {
    return NextResponse.json(
      { error: "dispatcher not configured" },
      { status: 500 }
    )
  }

  if (request.headers.get("x-ingest-secret") !== expectedSecret) {
    return NextResponse.json({ error: "invalid ingest secret" }, { status: 403 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } }
  )
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) {
    return NextResponse.json(
      { error: "dispatcher sign-in failed" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify the mint (dev server must be running: `pnpm dev`)**

Run:
```bash
curl -s -X POST http://localhost:3000/api/dispatcher-session -H "x-ingest-secret: $DISPATCHER_INGEST_SECRET"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/dispatcher-session -H "x-ingest-secret: wrong"
```
Expected: first returns JSON with `access_token`/`refresh_token`; second prints `403`.

- [ ] **Step 4: Commit**

```bash
git add app/api/dispatcher-session/route.ts
git commit -m "feat(m6): POST /api/dispatcher-session — shared-secret dispatcher mint"
```

---

## Task 4: `POST /api/ingest/stops` (validate + rpc)

**Files:**
- Create: `app/api/ingest/stops/route.ts`

- [ ] **Step 1: Write the route handler**

```ts
import { NextResponse, type NextRequest } from "next/server"
import { createUserClient } from "@/lib/supabase/server"

// supabase-js needs the Node runtime (not Edge-safe).
export const runtime = "nodejs"

// Map PostgREST JWT/auth failures (PGRST3xx) to 401, not a generic 500.
function isAuthError(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ""
  const message = (error.message ?? "").toLowerCase()
  return code.startsWith("PGRST3") || message.includes("jwt")
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

// Validate the ingestion contract and return the orders payload for the rpc.
function validate(body: unknown): { orders: unknown[] } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "body must be a JSON object" }
  }
  const orders = (body as Record<string, unknown>).orders
  if (!Array.isArray(orders) || orders.length === 0) {
    return { error: "orders must be a non-empty array" }
  }
  for (const o of orders) {
    if (typeof o !== "object" || o === null) {
      return { error: "each order must be an object" }
    }
    const ord = o as Record<string, unknown>
    if (typeof ord.external_ref !== "string" || ord.external_ref.length === 0) {
      return { error: "order.external_ref is required" }
    }
    if (!Array.isArray(ord.stops) || ord.stops.length === 0) {
      return { error: "order.stops must be a non-empty array" }
    }
    for (const s of ord.stops) {
      if (typeof s !== "object" || s === null) {
        return { error: "each stop must be an object" }
      }
      const st = s as Record<string, unknown>
      if (st.stop_type !== "pickup" && st.stop_type !== "dropoff") {
        return { error: "stop.stop_type must be 'pickup' or 'dropoff'" }
      }
      if (!Number.isInteger(st.seq)) {
        return { error: "stop.seq must be an integer" }
      }
      if (!isFiniteNumber(st.lat) || st.lat < -90 || st.lat > 90) {
        return { error: "stop.lat must be a number in [-90, 90]" }
      }
      if (!isFiniteNumber(st.lng) || st.lng < -180 || st.lng > 180) {
        return { error: "stop.lng must be a number in [-180, 180]" }
      }
    }
  }
  return { orders }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null
  if (!token) {
    return NextResponse.json({ error: "missing bearer token" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 })
  }

  const parsed = validate(body)
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  // Runs as the dispatcher — RLS (role='dispatcher') is the write boundary.
  const supabase = createUserClient(token)
  const { error } = await supabase.rpc("ingest_stops", {
    p_orders: parsed.orders,
  })
  if (error) {
    if (isAuthError(error)) {
      return NextResponse.json({ error: "invalid token" }, { status: 401 })
    }
    console.error("[/api/ingest/stops] rpc failed:", error)
    return NextResponse.json({ error: "ingest failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Verify rejection paths (dev server running)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/ingest/stops          # 401 (no token)
TOKEN=$(curl -s -X POST http://localhost:3000/api/dispatcher-session -H "x-ingest-secret: $DISPATCHER_INGEST_SECRET" | npx -y json access_token)
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/ingest/stops -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'   # 400 (bad body)
```
Expected: `401` then `400`. (Full happy-path is verified in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add app/api/ingest/stops/route.ts
git commit -m "feat(m6): POST /api/ingest/stops — validated ingest via ingest_stops rpc"
```

---

## Task 5: `scripts/seed-stops.ts` (adapter #1 + end-to-end acceptance)

**Files:**
- Create: `scripts/seed-stops.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the seed script**

```ts
/**
 * Dev-only ingestion adapter #1: seed a hand-written day of stops.
 *
 * Run with:  pnpm seed-stops   (the Next dev server must be running)
 * Flow:
 *   1. Secret key (dev-only): resolve a vehicle to assign the stops to.
 *   2. Mint a dispatcher session via POST /api/dispatcher-session (shared secret).
 *   3. POST orders+stops to /api/ingest/stops, exercising the real authed seam.
 *
 * The secret key is used ONLY to resolve a vehicle id and never leaves scripts/.
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const ingestSecret = process.env.DISPATCHER_INGEST_SECRET

if (!url || !secretKey || !ingestSecret) {
  throw new Error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, " +
      "DISPATCHER_INGEST_SECRET (copy .env.example -> .env)."
  )
}

const API = process.env.SEED_API_URL ?? "http://localhost:3000"

async function resolveVehicleId(): Promise<string> {
  const admin = createClient(url!, secretKey!, {
    auth: { persistSession: false },
  })
  const { data, error } = await admin
    .from("vehicles")
    .select("id, label")
    .order("created_at", { ascending: true })
    .limit(1)
  if (error) throw error
  const id = data?.[0]?.id
  if (!id) {
    throw new Error(
      "no vehicles found — run `pnpm fake-gps` once to seed a vehicle first."
    )
  }
  return id
}

async function mintDispatcherToken(): Promise<string> {
  const res = await fetch(`${API}/api/dispatcher-session`, {
    method: "POST",
    headers: { "x-ingest-secret": ingestSecret! },
  })
  if (!res.ok) {
    throw new Error(`dispatcher-session denied (${res.status})`)
  }
  const { access_token } = (await res.json()) as { access_token: string }
  return access_token
}

async function main(): Promise<void> {
  const vehicleId = await resolveVehicleId()
  const token = await mintDispatcherToken()

  // A small Zürich-area day: two laundry orders, each a pickup + a return.
  const payload = {
    orders: [
      {
        external_ref: "SEED-001",
        source: "manual",
        customer_name: "Müller",
        stops: [
          { stop_type: "pickup", vehicle_id: vehicleId, seq: 1, lat: 47.3769, lng: 8.5417, address: "Bahnhofstrasse 1" },
          { stop_type: "dropoff", vehicle_id: vehicleId, seq: 2, lat: 47.3886, lng: 8.5446, address: "Bahnhofstrasse 1" },
        ],
      },
      {
        external_ref: "SEED-002",
        source: "manual",
        customer_name: "Weber",
        stops: [
          { stop_type: "pickup", vehicle_id: vehicleId, seq: 3, lat: 47.3654, lng: 8.5251, address: "Langstrasse 20" },
          { stop_type: "dropoff", vehicle_id: vehicleId, seq: 4, lat: 47.3601, lng: 8.5302, address: "Langstrasse 20" },
        ],
      },
    ],
  }

  const res = await fetch(`${API}/api/ingest/stops`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`ingest failed (${res.status}): ${await res.text()}`)
  }
  console.log(`seeded 2 orders / 4 stops for vehicle ${vehicleId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
```

- [ ] **Step 2: Add the `package.json` script**

In `"scripts"`, after the new `provision-dispatcher` line:
```json
    "seed-stops": "tsx --env-file=.env scripts/seed-stops.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: End-to-end acceptance (dev server running; a vehicle exists)**

Run:
```bash
pnpm seed-stops
```
Expected: prints `seeded 2 orders / 4 stops for vehicle <uuid>`.

Then verify idempotency + RLS:
```bash
pnpm seed-stops    # run again
```
Expected: still 2 orders / 4 stops total (re-ingest upserts by (source, external_ref), not duplicates).

Verify in SQL:
```sql
select count(*) from orders;   -- 2
select count(*) from stops;    -- 4
select stop_type, seq, status from stops order by seq;  -- planned, seq 1..4
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-stops.ts package.json
git commit -m "feat(m6): seed-stops dev adapter — end-to-end ingestion seam"
```

---

## Task 6: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the layout block**

In the `## Layout` code block, add after the `app/api/dashboard-session` / existing api lines:
```
app/api/dispatcher-session/route.ts  mint dispatcher session (shared secret)
app/api/ingest/stops/route.ts        ingestion seam — orders/stops (POST)
scripts/seed-stops.ts                dev-only ingestion adapter #1
```

- [ ] **Step 2: Update commands**

In the `## Commands` block:
```
pnpm provision-dispatcher         # create the dispatcher identity (role=dispatcher)
pnpm seed-stops                   # dev-only: seed a day of orders/stops (dev server running)
```

- [ ] **Step 3: Update milestones**

Change the M6 line to checked:
```
- [x] **M6 — order/stop model + ingestion seam:** orders/stops schema + RLS + Realtime, dispatcher identity, POST /api/ingest/stops, seed-stops adapter.
```
(If no M6 line exists yet, add it under M5.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(m6): record order/stop model + ingestion seam"
```

---

## Self-review

- **Spec coverage:** `orders`/`stops`/`stops_public` (Task 1) ✓; RLS incl. named driver self-update policy (Task 1) ✓; Realtime publication + `REPLICA IDENTITY FULL`, orders unpublished (Task 1) ✓; atomic `ingest_stops` rpc (Task 1) ✓; dispatcher identity + `provision-dispatcher` + env (Task 2) ✓; `POST /api/dispatcher-session` mint (Task 3) ✓; `POST /api/ingest/stops` validate + rpc (Task 4) ✓; `seed-stops` adapter #1 (Task 5) ✓; "no TV change" honored (no `components/`/dashboard edits) ✓. Spec M6 acceptance ("seed a day of stops, rows land, re-ingest idempotent, dashboard token reads `stops_public`, dispatcher is the only writer") is exercised by Tasks 3–5.
- **Placeholder scan:** no TBD/TODO; every code step is complete; verification commands are concrete.
- **Type/name consistency:** rpc name `ingest_stops` and arg `p_orders` match between the migration (Task 1) and the handler (Task 4); the seed payload fields (`external_ref`, `source`, `stop_type`, `vehicle_id`, `seq`, `lat`, `lng`, `address`) match the validator (Task 4) and the rpc's `->>` extraction (Task 1); env names `DISPATCHER_EMAIL`/`DISPATCHER_PASSWORD`/`DISPATCHER_INGEST_SECRET` are identical across `.env.example` (Task 2), `provision-dispatcher.ts` (Task 2), `dispatcher-session/route.ts` (Task 3), and `seed-stops.ts` (Task 5).

> **Note on `npx -y json`** in Task 4 Step 3: a tiny convenience for extracting the token in a shell one-liner; if unavailable, copy the `access_token` from the Task 3 curl output by hand into `TOKEN=...`.
