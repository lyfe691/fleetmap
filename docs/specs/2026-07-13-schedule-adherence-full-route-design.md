# Full-day route, schedule adherence, and a stop redesign

**Date:** 2026-07-13 · **Status:** design, ready to build. No upstream
dependency — everything here is doable with the data and stack we already have.
One small DB migration (below) needs applying to the shared Supabase, same as
the M14 distance RPC.

**Origin:** boss request — "see the *full* route" (it shouldn't vanish, finished
parts should go grey), "show when I should arrive and when I arrived," and "red
route if I'm late." Plus two follow-ons from Yanis: the **stop design should be
better** while we're in here, and the **dev fake-GPS/seed data should produce
bigger, multi-stop routes** so this is actually demoable.

---

## The core finding (why the route "vanishes")

`GET /api/route` today builds waypoints as `[live van position, ...stops where
status in (planned, arrived)]` — it **filters out completed stops** and starts
from the van. So the geometry is only ever the road *ahead*. The moment a stop
completes it drops out and the route recomputes; the leg to it disappears. The
`route-slice` grey/colored split only greys the traveled part of that
ahead-only line. Stop *pins* stay (they fade via `terminal`); the *line* behind
the van does not exist. So "see the full route" and "grey, don't vanish after
finishing" are the same gap, and the fix is: **route through all of the day's
stops and move the done/ahead boundary on the client.**

There is also no per-stop timing on screen, and the dashboard's `Stop`
(`lib/use-live-stops.ts`) carries `eta_at` (scheduled) but **not** `completed_at`
(actual arrival), so "when I arrived" isn't even available to render yet.

## Goals / non-goals

**Goals:** (1) draw the whole day's route with finished legs greyed and the road
ahead coloured; (2) show scheduled vs actual arrival per stop; (3) turn a van's
remaining route red when it's behind schedule; (4) a cleaner stop design on the
map and in the itinerary; (5) dev data that produces realistic multi-stop days.

**Non-goals:** changing the order/stop data model or the sync; adding a depot
geometry (we don't store per-van depot coordinates — the route spans stop 1 →
stop N); OSRM `/match` (still the documented future upgrade for GPS snapping).

---

## Design

### 1. Full-day route

**`/api/route` change.** Route through **all** of the vehicle's stops in `seq`
order, regardless of status, and **drop the live-position origin**:

- Waypoints = every stop `[lng, lat]` in `seq` order (remove the
  `.in("status", ["planned","arrived"])` filter and the `[vehicle.last_lng,
  vehicle.last_lat]` prefix).
- `legs`, `stopOffsets`, and `stops` then cover the entire day. `stopOffsets`
  already gives each stop's `lineFraction` (0..1) along the full geometry — that
  is the schedule-side grey boundary.
- Keep returning `status` per stop (already does) so the client knows which
  stops are done.

**Why dropping the van origin is right, not a regression:** the geometry becomes
a function of the **stop set** (ids · positions · seq) only — not van movement,
not status. So it recomputes *only* when stops are added / removed / reordered,
never when a van moves or a stop completes. That's strictly less OSRM churn than
today, and it reinforces the M15 invariant (stable stop ids → no refetch). The
van's live position is used purely client-side to place the boundary.

**Client split (`route-slice` / `use-route-features`).** The grey (done)
boundary is:

```
boundary = max( lineFraction of the last completed stop ,
                fraction of the van's snapped position on the line )
```

Everything before `boundary` renders grey (done); everything after renders
coloured (ahead), or **red** when the van is late (§2). The van-snap keeps the
forward-only clamp it has today (`MAX_FORWARD_KM`, `held`). Using the completed
stop's `lineFraction` as a floor means a finished leg is fully grey even if GPS
hasn't snapped past it yet.

**Rendering (`fleet-map-view`).** Same two-source structure (traveled/remaining)
it has now; the "remaining" source's `line-color` becomes data-driven so a late
van's remaining line is red (§2). Grey/done styling unchanged.

**Framing ("a bit small with 20 stops").** When a van is selected, fit the
camera to that van's **full route bounds** (not just the van point) so the whole
day is visible; the fleet view keeps its fit-to-fleet. This is the real answer to
"small" — the full route is now drawable, so frame to it.

### 2. Schedule adherence → red route

**"Late" definition.** A van is late when its **projected arrival at the next
active stop** is later than that stop's scheduled `eta_at` by more than a grace
window:

```
projectedArrival = now + estRemainingDriveToNextStop
late = eta_at(nextStop) != null && projectedArrival > eta_at + GRACE
```

- `GRACE`: one constant, **5 min** (tunable), so trivial slippage doesn't flap
  the map red.
- `estRemainingDriveToNextStop`: derive from the full-day route — the next stop's
  leg `duration` scaled by the un-driven fraction of the current leg (from the
  van's snapped position between the previous and next stop offsets). One route
  serves both the line and this estimate; no second OSRM call.
- **Degraded fallback:** if the route/estimate isn't available yet, fall back to
  `now > eta_at(nextStop) + GRACE` (the scheduled time has simply passed). Never
  render late without an `eta_at` to compare against.

**Rendering.** When late: the van's **remaining route line turns red** (done
portion stays grey). Reinforce it off-map with a **"Late" chip** on the fleet
card and in the tracking itinerary; the fleet map legend gains a red "Behind
schedule" entry. Leave the van marker on its status tone — don't overload it.
Lateness is per-van, so on the fleet map each van colours independently.

### 3. Stop timing (scheduled + actual)

**Data — the one migration.** Add `completed_at` to the `stops_public` view
(migration `0011`; it's a timestamp, not PII, so safe to expose). Then add
`completed_at: string | null` to the `Stop` type and the `COLUMNS` string in
`lib/use-live-stops.ts`. **This migration must be applied to the shared Supabase
by a human** (`supabase db push` / SQL editor) — same handoff as the M14 distance
RPC; the client renders "—" until it lands.

**Display — the itinerary is the home for per-stop times.** Each row in the
tracking-view itinerary shows:

- **Scheduled** arrival: `formatClock(eta_at)`.
- **Completed** stops: actual arrival `formatClock(completed_at)` plus a delta
  chip — "on time" within `GRACE`, else "+N min late" / "N min early".
- **Next** stop: scheduled time plus the projected ETA and, if applicable, the
  same late treatment as the route.

Keep detailed timing in the itinerary, not on the map pins — the wall TV map
stays glanceable (route colour + pins carry the map story; the panel carries the
numbers).

### 4. Better stop design

Treat this as a deliberate redesign of how a stop reads, on both surfaces, now
that stops carry status + timing + lateness. Direction (visual specifics are the
implementer's, but the goals are firm):

- **Map markers (`StopMarker`).** Legible at ~20 stops without becoming a
  cluttered blob. Distinguish **pickup vs dropoff** by more than colour alone
  (shape/icon), and give a clear three-state language: **done** (subtle, e.g. a
  small check, de-emphasised), **next** (emphasised/accent — the one that
  matters), **upcoming** (neutral). The next-stop marker may pick up the red
  tint when the van is late. Consider seq numbers only on select/hover, not
  always-on, to avoid clutter.
- **Itinerary rows.** Fold the §3 timing in cleanly, on-system with the console
  cards; keep the next-stop emphasis (it already uses the animated status ring).
  A clear done / next / upcoming rhythm, not a flat list.

Scope note: this is polish, keep it *rich but calm* — no new animation
theatrics; the point is clarity at a glance on a TV.

### 5. Demo data — bigger routes

So the above is demoable end to end:

- **`scripts/cities.ts`** — more stops per city (target ~15–20), spread across a
  real service area so the route is a substantial multi-leg path, not three
  points.
- **`scripts/seed-stops.ts`** — seed realistic `eta_at` values across the day so
  lateness is exercisable (some reachable on time, some not), and set
  `completed_at` on already-completed stops so the actual-arrival + delta UI has
  data.
- **`scripts/fake-gps.ts`** — drive the longer routes; advance stop status as the
  van passes stops (stamping `completed_at`) so the grey boundary, the timing
  chips, and the late/red path all move live during a demo.

---

## Build order (roughly independent slices)

1. **Full-day route + grey (§1)** — the visible core; API change + client split +
   framing. Delivers "see the full route / grey, don't vanish" on its own.
2. **`completed_at` migration + timing in the itinerary (§3)** — needs the human
   to apply `0011`; renders "—" until then.
3. **Lateness + red route (§2)** — builds on the full-day route's legs.
4. **Better stop design (§4)** — map markers + itinerary rows, once timing/status
   are flowing.
5. **Demo data (§5)** — do alongside, needed to actually see 1–4.

## i18n

New keys (en + de-CH parity): the itinerary time labels ("Scheduled", "Arrived",
"on time", "{n} min late", "{n} min early"), the "Late" / "Behind schedule" chip
+ legend entry. Reuse `formatClock`.

## Open decisions I made (delegated — flag any to change)

- **`GRACE` = 5 min**, single constant.
- **Late = projected** (now + est. remaining drive) vs scheduled, with a
  "scheduled time passed" fallback — rather than only the simpler "eta passed."
- **Red = the remaining route line** (not the whole route, not the van marker),
  plus off-map chips.
- **Per-stop times live in the itinerary**, not on map pins.
- **Route spans stop 1 → stop N** (no depot leg — we don't store depot coords).

## Testing / verify

- Unit: extend `route-slice` tests for the completed-offset floor and the
  done/ahead boundary; a small lateness helper (projected vs scheduled + grace)
  is pure and worth its own tests.
- E2E-ish: seed a big day, run fake-GPS, watch the grey boundary advance, stops
  stamp actual arrival, and a deliberately-delayed van's remaining route go red.
- `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build` before done; apply `0011`
  to see the timing populate.
