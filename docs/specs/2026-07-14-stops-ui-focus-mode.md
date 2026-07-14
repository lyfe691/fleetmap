# Stops UI redesign — focus mode

**Date:** 2026-07-14 · **Status:** design, ready to build. Pure client-side
polish — no API, schema, or data-model change. Follows M16 (full-day route +
schedule adherence), which put status/timing/lateness on stops; this fixes how
they *read*.

**Origin:** Yanis — "not a big fan of the stops UI, it's just so bad." The M16
markers (circle=pickup / square=dropoff, three-state) are functionally correct
but visually noisy: ~17 same-weight shapes per van float over three routes and
read as confetti, with no sequence information and no hierarchy between "the
stop that matters now" and "stop 14 of a van you're not looking at."

## Diagnosis (what's actually wrong)

1. **No sequence.** The single most important fact about a route stop — when
   it comes — isn't shown. Every dispatch product (Onfleet, Routific,
   Route4Me) numbers its stops.
2. **Confetti.** All stops render at the same visual weight regardless of
   relevance, detached from the line they belong to.
3. **Everything always shown.** Uber's cardinal map rule is the opposite: you
   only see *your* trip. We render every van's stops at full strength even
   when a van is selected.
4. **Pickup-vs-dropoff shape spends the visual budget on the least useful
   dimension.** At TV distance a 12 px circle and a 12 px rounded square are
   the same blob; the itinerary is where that distinction belongs.

## Design — two-tier "focus mode"

The map has exactly two states, keyed off the existing `selectedId`:

### Fleet view (nothing selected)

- Every stop demotes to a **small on-line dot**: white fill, 2 px ring in the
  van's remaining-line colour (route teal, or the late red when that van is
  behind schedule), done stops ring in the traveled grey. Google-Maps-style
  waypoint dots — texture of the route, not markers.
- Each van's **next** stop keeps a slightly larger dot so the fleet view still
  shows where everyone is headed.
- No numbers, no badges, no pickup/dropoff distinction, no labels. The route
  lines, the vans, and the red/grey colour split carry the whole story.

### Focus mode (a van is selected)

- **Other vans fade.** Their route lines (traveled + remaining + casing) and
  stop dots drop to ~15% opacity. Their van markers stay full strength — this
  is a fleet monitor, the vans themselves must stay visible. Implementation:
  data-driven opacity expressions keyed on `vehicle_id` vs the selected id
  (line layers), and a `dimmed` prop on the DOM stop markers.
- **The selected van's stops upgrade to numbered badges.** The number is the
  stop's 1..N ordinal in that van's seq-sorted stop list (not raw `seq`,
  which may have gaps). Three states:
  - **done** — small muted-grey badge, white number, ~55% opacity. No
    checkmark: the grey line already says "done"; the number keeps the
    map↔itinerary correspondence.
  - **next** — enlarged badge in the route accent (late red when behind),
    white number, white ring + the existing soft halo. The one that matters.
  - **upcoming** — medium badge, surface-white fill, dark number, 2 px border
    in the route colour. Quieter than "next", clearly ahead of "done".
- **One callout, Uber-style:** the next stop carries a small pill anchored
  below the badge showing the projected arrival clock (`formatClock` of M16's
  `projectedArrivalMs`), red text when late. One pill per map, 1 short word of
  content — respects Uber's own annotation guideline (1–5 words).
- Pickup vs dropoff disappears from map markers entirely (moves to the
  itinerary, which already labels it).

### Itinerary (tracking view)

Rows become the same object as the map, connected:

- Each row's leading glyph becomes the **same numbered badge** as the map
  (done = muted number, next = accent + existing animated ring, upcoming =
  bordered number).
- A **vertical timeline rail** connects the badges through the list — muted
  above the current position, accent below — the courier-app pattern that
  makes list order legible at a glance.
- The M16 timing columns (Scheduled / Arrived+delta / projected ETA) are
  unchanged.

## Implementation map

| Piece | Change |
| --- | --- |
| `components/map/vehicle-marker.tsx` | Replace `StopMarker` with `StopDot` (fleet tier) + `StopBadge` (focus tier); both take state + colours; badge takes `number`, `late`, `etaLabel?` |
| `components/map/fleet-map-view.tsx` | Marker tier chosen by `selectedId`; ordinal computation per van; dim non-selected route layers via paint expressions; extend the `lateIds` memo to keep full `Lateness` per van (projected ETA feeds the pill); selected van's markers render last (z-order) |
| `lib/stop-ordinals.ts` (new, tiny) | Pure `stopOrdinals(stops)` → `Map<stopId, number>` (1..N in seq order), unit-tested — shared by map + itinerary |
| `components/console/tracking-view.tsx` | StopRow leading glyph → numbered badge + timeline rail; timing columns untouched |
| `lib/map-theme.ts` | Add `stopBadgeText` / surface fill tokens if needed; drop now-unused `pickup`/`dropoff` marker colours **only if** nothing else uses them (dispatch `pin-map` has its own pin) |
| i18n | No new keys expected (the pill is a clock time). If any label sneaks in, en + de-CH parity as usual |

## Non-goals

- No clustering, no zoom-dependent tiers (17 stops/van doesn't need it; the
  dot tier already handles fleet zoom).
- No symbol-layer migration — DOM markers are fine at this scale and keep the
  existing interpolation/a11y patterns.
- No itinerary information changes — M16's timing model stays as is.
- Dispatch console (`pin-map`, orders list) untouched.

## Risks / edge cases to handle

- **Ordinals vs live churn:** ordinals derive from the live seq-sorted stop
  list; a reorder renumbers instantly (correct — the itinerary renumbers too,
  and they can never disagree because both use the shared helper).
- **Selected van with no route yet** (fetch in flight): badges still render
  (they key off stops, not the route); the pill simply doesn't (no projected
  ETA). Dimming keys off `selectedId` alone.
- **Late tint:** only the *next* badge and the pill pick up red; done/upcoming
  badges stay neutral so the map doesn't turn into a red rash.
- **Theme:** all colours via `mapColors(theme)`; badge text must pass contrast
  on both themes (white-on-grey and dark-on-white both checked).
- **Perf:** ordinals are O(n) per stops change (memoised); dimming is a paint
  property change, not a source change — no geometry recompute.

## Verify

- `pnpm exec tsc --noEmit`, `pnpm test` (new `stop-ordinals` test; existing
  suites untouched), `pnpm build`.
- Visual: `pnpm dev` + fake-gps — fleet view reads as three clean lines with
  dot texture; selecting Van Bern shows numbered badges, others fade, next
  badge red with ETA pill; itinerary numbers match the map.
