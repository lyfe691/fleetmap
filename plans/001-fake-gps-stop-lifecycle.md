# Plan 001: fake-gps advances stop lifecycle so routes shrink, grey, and follow the truck

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report —
> do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 7d9801a..HEAD -- scripts/fake-gps.ts app/api/route/route.ts lib/route-slice.ts components/map/fleet-map.tsx CLAUDE.md`
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (dev-only script + a docs note; no production code, schema, RLS, or API change)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `7d9801a`, 2026-06-17

## Why this matters

On the live TV the route is supposed to grey out behind each truck and the truck
marker is supposed to ride along its drawn line. Today neither happens: the route
stays fully blue and the marker drifts off the line. The rendering code is
correct — the cause is that **no stop ever changes status, so a truck's "active
stops" never shrink.** `GET /api/route` always routes `[live position] → every
still-planned stop`, including stops the truck already drove past, so the drawn
line doubles back behind the truck. The greying helper (`splitRoute`) then snaps
the live position onto that doubled-back line, the forward-only clamp rejects the
backward snap, and the grey boundary is held at zero forever.

In production the active set will shrink via geofenced "arrived" events (a later
milestone). Until that exists, the dev feed (`fake-gps`) drives the route but
never reports arrivals — so the whole greying/ETA/fade feature set has nothing to
react to. This plan makes `fake-gps` mark each stop `completed` as the truck
reaches it. That removes passed stops from the route (no more doubling back →
marker follows the line), lets the route re-anchor to the live position through
the *remaining* stops (grey advances per leg; ETA-to-next-stop stays correct),
and finally exercises the terminal-stop fade. No production code changes — this
confirms the M8 rendering was right and only the simulated data lifecycle was
missing.

## Current state

Files in play (only `scripts/fake-gps.ts` and `CLAUDE.md` are modified):

- `scripts/fake-gps.ts` — dev GPS feed. Reads the vehicle's active stops, asks
  OSRM for a route through them, and POSTs interpolated positions along it. It
  **never updates stop status.**
- `app/api/route/route.ts` — the route proxy the dashboard reads. Routes
  `[vehicle live position, ...active stops]`. **Unchanged by this plan** — shown
  here only so you understand why lifecycle is the fix.
- `lib/route-slice.ts` — `splitRoute` greying helper. **Unchanged.**
- `components/map/fleet-map.tsx` — renders grey/blue lines + terminal fade.
  **Unchanged.**

How `fake-gps` reads stops today (`scripts/fake-gps.ts:92-107`) — note it selects
only `lng, lat` and drops the id and seq:

```ts
async function getActiveStops(
  admin: SupabaseClient,
  vehicleId: string
): Promise<Pt[]> {
  const { data, error } = await admin
    .from("stops")
    .select("lng, lat, seq, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
  if (error) throw error
  return ((data ?? []) as { lng: number; lat: number }[]).map((s) => [
    s.lng,
    s.lat,
  ])
}
```

How it fetches geometry today (`scripts/fake-gps.ts:109-124`) — it returns only
the coordinate array, discarding OSRM's per-leg distances:

```ts
async function fetchRouteGeometry(waypoints: Pt[]): Promise<Pt[] | null> {
  const coords = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(";")
  const u = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const json = (await res.json()) as {
      code: string
      routes?: { geometry: { coordinates: Pt[] } }[]
    }
    if (json.code !== "Ok" || !json.routes?.[0]) return null
    return json.routes[0].geometry.coordinates
  } catch {
    return null
  }
}
```

The drive loop today (`scripts/fake-gps.ts:249-283`) — it builds the path from
`[stops[0], ...stops]` and walks `dist` along it, but does nothing on arrival:

```ts
  const geometry =
    stops.length > 0 ? await fetchRouteGeometry([stops[0], ...stops]) : null
  ...
  const path = buildPath(geometry)
  const step = SPEED_MPS * (TICK_MS / 1000)
  ...
  let dist = 0
  for (;;) {
    const { pos, heading } = pointAt(path, dist)
    const atEnd = dist >= path.total
    await post(pos[1], pos[0], heading, atEnd ? 0 : SPEED_MPS)
    if (atEnd) { await sleep(TICK_MS); continue }
    dist = Math.min(dist + step, path.total)
    await sleep(TICK_MS)
  }
```

`buildPath` (`scripts/fake-gps.ts:153-161`) returns `{ coords, cum, total }` where
`cum[i]` is metres from the path start to vertex `i`. `admin` is a service-role
Supabase client (`scripts/fake-gps.ts:203`) that bypasses RLS — it is the right
tool to update stop status in this dev script. The `stops` table has a `status`
column whose terminal values include `completed` (see `supabase/migrations/0004_orders_stops.sql`);
`fleet-map.tsx` treats any status that is not `planned`/`arrived` as terminal
(faded + dropped from the route).

Conventions to match: this file uses plain `async` functions, `console.log` for
progress, throws `Error` with actionable messages, and keeps comments terse and
purpose-first (no rationale-dump comments). Match that density. TypeScript
throughout; default turf-style imports already in the file show the import style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `pnpm exec tsc --noEmit` | exit 0, except the pre-existing `components/ui/calendar.tsx` shadcn error — ignore ONLY that one |
| Lint | `pnpm lint` | exit 0 (no new warnings in `scripts/fake-gps.ts`) |
| Run the feed (manual acceptance) | `pnpm fake-gps` | logs driving progress; see Step 4 |

There is no automated test suite (per `CLAUDE.md`); the gate is `tsc` clean plus
the manual acceptance in Step 4.

## Scope

**In scope** (the only files you may modify):
- `scripts/fake-gps.ts`
- `CLAUDE.md` (one note under Conventions or the M8 milestone line)

**Out of scope** (do NOT touch, even though they look related):
- `app/api/route/route.ts` — keeping the live-position waypoint is deliberate;
  it is what makes `legs[0].duration` mean "ETA to the next stop." Do not change
  the waypoint construction.
- `lib/route-slice.ts`, `components/map/fleet-map.tsx`, `lib/use-fleet-routes.ts`
  — the rendering path is correct; changing it is out of scope and will mask the
  real fix.
- The database schema / migrations / RLS — no schema change is needed; `status`
  and the `completed` value already exist.

## Git workflow

- Branch: `advisor/001-fake-gps-stop-lifecycle` (off the current branch).
- One commit for the change; conventional-commit style to match `git log`, e.g.
  `fix(m8): fake-gps marks stops completed as it passes — routes shrink + grey`.
- End the commit body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Carry the stop id (and seq) through `getActiveStops`

Change `getActiveStops` to return objects, not bare coordinate pairs, so the loop
can mark a specific stop completed. Introduce a small type and keep the existing
`Pt` for geometry.

Target shape:

```ts
type Stop = { id: string; lng: number; lat: number }

async function getActiveStops(
  admin: SupabaseClient,
  vehicleId: string
): Promise<Stop[]> {
  const { data, error } = await admin
    .from("stops")
    .select("id, lng, lat, seq, status")
    .eq("vehicle_id", vehicleId)
    .in("status", ["planned", "arrived"])
    .order("seq", { ascending: true })
  if (error) throw error
  return ((data ?? []) as { id: string; lng: number; lat: number }[]).map(
    (s) => ({ id: s.id, lng: s.lng, lat: s.lat })
  )
}
```

Update the call site in `main` (`const stops = await getActiveStops(...)`) — it
now holds `Stop[]`. Anywhere geometry needs `Pt`, use `[s.lng, s.lat]`.

**Verify**: `pnpm exec tsc --noEmit` → only the known `calendar.tsx` error.

### Step 2: Return per-stop along-route offsets from the geometry fetch

The truck must know *how far along the driven path* each stop sits, so it can
mark a stop completed when it passes it. OSRM returns this: request the route
through the stops (no duplicated first stop) and read `legs[].distance` — the
cumulative sum gives the metres-from-start of each stop.

Replace `fetchRouteGeometry` with a function that returns both the coordinates
and the cumulative stop offsets. Build it from the **stops in order** (do not
duplicate `stops[0]`):

```ts
type DrivenRoute = { coords: Pt[]; stopOffsets: number[] } // offsets[i] = metres to stops[i]

async function fetchDrivenRoute(stops: Stop[]): Promise<DrivenRoute | null> {
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(";")
  const u = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const json = (await res.json()) as {
      code: string
      routes?: {
        geometry: { coordinates: Pt[] }
        legs?: { distance: number }[]
      }[]
    }
    const route = json.routes?.[0]
    if (json.code !== "Ok" || !route) return null
    // legs[j] spans stops[j] -> stops[j+1]; cumulative distance = offset of each stop.
    const offsets = [0]
    for (const leg of route.legs ?? []) {
      offsets.push(offsets[offsets.length - 1] + leg.distance)
    }
    return { coords: route.geometry.coordinates, stopOffsets: offsets }
  } catch {
    return null
  }
}
```

Note: with N stops OSRM returns N−1 legs, so `offsets` has N entries — one per
stop, `offsets[0] === 0`. Remove the old `fetchRouteGeometry`.

**Verify**: `pnpm exec tsc --noEmit` → only the known `calendar.tsx` error.

### Step 3: Mark stops completed as the truck passes them, in the drive loop

In `main`, replace the geometry fetch and drive loop so that:

1. It calls `fetchDrivenRoute(stops)` (needs ≥ 1 stop; the old fallback messaging
   stays for "no stops" / "OSRM unavailable").
2. It builds the path from `route.coords` (your existing `buildPath`).
3. It tracks the next un-completed stop index, and whenever `dist` reaches that
   stop's offset, it updates that stop's status to `completed` via `admin` and
   advances the index. Mark `stops[0]` completed up front (the truck starts on
   it), so the route's active set excludes the origin immediately.

Add a helper and wire it in:

```ts
async function completeStop(admin: SupabaseClient, stopId: string): Promise<void> {
  const { error } = await admin
    .from("stops")
    .update({ status: "completed" })
    .eq("id", stopId)
  if (error) console.warn(`could not complete stop ${stopId}: ${error.message}`)
  else console.log(`stop ${stopId} -> completed`)
}
```

Drive loop shape (replaces the current `const geometry = ...` block through the
end of the `for (;;)` loop). `stops` is the `Stop[]` from Step 1, `route` the
`DrivenRoute` from Step 2:

```ts
  const route = stops.length > 0 ? await fetchDrivenRoute(stops) : null
  if (!route || route.coords.length < 2) {
    const why =
      stops.length === 0
        ? "no active stops (run `pnpm seed-stops` first)"
        : "OSRM route unavailable (is `docker compose up -d osrm` running?)"
    console.log(`${why} — falling back to random wander.`)
    await randomWalk(post)
    return
  }

  const path = buildPath(route.coords)
  const step = SPEED_MPS * (TICK_MS / 1000)
  console.log(
    `driving ${(path.total / 1000).toFixed(1)} km through ${stops.length} ` +
      `stops at ${SPEED_MPS} m/s; reload the dashboard to watch the trail grey. ` +
      `(Ctrl+C to stop)`
  )

  // The truck starts on stops[0]; report it arrived so the route excludes it.
  let nextStop = 1
  await completeStop(admin, stops[0].id)

  let dist = 0
  for (;;) {
    const { pos, heading } = pointAt(path, dist)
    const atEnd = dist >= path.total
    await post(pos[1], pos[0], heading, atEnd ? 0 : SPEED_MPS)

    // Mark every stop the truck has now reached as completed (advances the route).
    while (nextStop < stops.length && dist >= route.stopOffsets[nextStop]) {
      await completeStop(admin, stops[nextStop].id)
      nextStop++
    }

    if (atEnd) {
      await sleep(TICK_MS)
      continue
    }
    dist = Math.min(dist + step, path.total)
    await sleep(TICK_MS)
  }
```

Keep `randomWalk`, `post`, `buildPath`, `pointAt`, `bearingDeg`, etc. unchanged.

**Verify**: `pnpm exec tsc --noEmit` → only the known `calendar.tsx` error.
`pnpm lint` → exit 0.

### Step 4: Manual end-to-end acceptance

Prereqs (start each if not already running): `docker compose up -d osrm`;
`pnpm dev`; `pnpm seed-stops` (seeds 4 stops); enter the display code on the TV
at `/dashboard`. Then `pnpm fake-gps`.

Confirm ALL of:

- The script logs `stop <id> -> completed` lines as it drives, one per stop in
  order, starting with the first stop near the beginning.
- On the dashboard, each active vehicle's line shows **blue ahead, grey behind**
  the truck; as it drives, grey **grows** and never snaps backward.
- The **truck marker stays on its drawn line** (it does not drift off toward a
  doubled-back segment).
- As each stop is reached it **fades** (terminal styling) and the **next stop**
  becomes the emphasized (larger) dot; the rail's "N stops left" **decreases**.
- The rail still shows `Next: Pickup/Dropoff · <ETA> · N stops left`, and the ETA
  is a plausible few-minutes value (not `<1 min` for a far stop).
- In the browser Network tab, `/api/route` fires on **stop completions** (status
  changes), not on every GPS POST.

If you cannot run the stack (no Docker / no Supabase env), STOP and report that
the change typechecks and lints but acceptance is unverified — do not claim the
bug is fixed.

### Step 5: Document the simulated lifecycle in CLAUDE.md

Add one line so the next reader knows fake-gps now simulates arrivals. In
`CLAUDE.md`, under the `scripts/fake-gps.ts` entry in the Layout block (or as a
short note on the M8 milestone line), state: fake-gps marks each stop `completed`
as the truck reaches it, simulating the geofenced "arrived" events that the
"Later" milestone will emit for real. Keep it to one sentence; match the file's
terse style.

**Verify**: `git diff --stat` shows only `scripts/fake-gps.ts` and `CLAUDE.md`
changed.

## Test plan

No automated suite exists. Verification is:
- `pnpm exec tsc --noEmit` clean (except the known `calendar.tsx` error).
- `pnpm lint` clean.
- The Step 4 manual acceptance, all bullets observed.

Do not add a test framework as part of this plan (that is Plan-independent and
out of scope here).

## Done criteria

ALL must hold:

- [ ] `pnpm exec tsc --noEmit` exits 0 except the known `components/ui/calendar.tsx` error.
- [ ] `pnpm lint` exits 0.
- [ ] `scripts/fake-gps.ts` no longer contains `fetchRouteGeometry`; it contains `fetchDrivenRoute` and `completeStop`.
- [ ] `getActiveStops` selects and returns the stop `id`.
- [ ] Step 4 acceptance observed (grey grows, marker on line, stops fade, stops-left decreases) — or, if the stack can't be run, that limitation is reported instead of asserting the fix.
- [ ] `git status` shows only `scripts/fake-gps.ts` and `CLAUDE.md` modified.
- [ ] `plans/README.md` status row for 001 updated.

## STOP conditions

Stop and report (do not improvise) if:

- The drift check shows `app/api/route/route.ts`, `lib/route-slice.ts`, or
  `components/map/fleet-map.tsx` changed since `7d9801a` and no longer match the
  excerpts here — the data-lifecycle assumption may no longer hold.
- OSRM returns a route with **no `legs`** array (older OSRM builds) — then
  `stopOffsets` can't be computed from legs; report this so the approach can fall
  back to projecting stops onto the geometry instead.
- The `stops` table has no `completed` value in its status check constraint, or
  the `admin.update` is rejected — report rather than inventing a status value.
- After the change the marker still drifts off the line in acceptance — capture
  what the route line looks like (does it still double back?) and report; do not
  start editing the rendering code.

## Maintenance notes

For whoever owns this next:

- When the real geofenced "arrived"/"completed" events land (the "Later"
  milestone), this fake-gps simulation becomes redundant for that path — the
  dashboard will react to real status changes the same way. Keep fake-gps's
  completion logic as a dev convenience or gate it behind a flag then.
- The "ETA to next stop" correctness depends on `/api/route` keeping the live
  position as `waypoint[0]` so `legs[0]` spans position→next-stop. If anyone
  changes that waypoint construction, revisit the rail ETA (`fleet-map.tsx`,
  `routes.get(v.id)?.legs[0]?.duration`).
- `SPEED_MPS` (env `FAKE_GPS_SPEED`, default 12) sets how fast stops complete;
  reviewers testing this can lower it to watch the greying advance slowly.
- Reviewer should scrutinize: that `stopOffsets[0] === 0` and the first stop is
  completed up front (otherwise the first leg of the dashboard route briefly
  doubles back), and that `completeStop` failures only `warn` (a dev feed must
  not crash on a transient DB hiccup).
