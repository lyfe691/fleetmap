# Stops UI redesign — focus mode

**Date:** 2026-07-14 · **Status:** implemented 2026-07-14 (plan and diff each
adversarially reviewed; findings folded in). Pure client-side
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
- **One callout, Uber-style:** the next stop carries a small pill showing the
  projected arrival clock (`formatClock` of M16's `projectedArrivalMs`), red
  text when late. One pill per map, one short token of content — respects
  Uber's own annotation guideline (1–5 words). Anchoring: absolutely
  positioned below the badge (`top-full left-1/2 -translate-x-1/2`, same
  pattern as the van label) so the badge stays centred on its coordinate.
  **Hidden while the next stop's status is `arrived`** — at that moment the
  van (which carries its own below-anchored label pill) sits on the same
  pixels, and the projection is ~now anyway.
- Pickup vs dropoff disappears from map markers entirely (moves to the
  itinerary, which already labels it).
- **Z-order is explicit, not render order.** react-map-gl markers are DOM
  siblings added at mount; JSX order can't restack them later. Each `Marker`
  gets `style={{ zIndex }}` per tier: dimmed dots < dots < badges < next
  badge+pill < vans (the `style` prop re-applies on change).

### Mini-map (tracking view's Live Location panel)

Gets `selectedId={vehicle.id}`. It *is* a focused view of one van, and it sits
directly under the numbered itinerary — fleet-tier anonymous dots there would
break map↔list correspondence on the one screen where it matters most. Safe:
`follow` short-circuits the camera policy, `followTarget` already resolves to
the same van, and dimming is a no-op with one vehicle.

### Itinerary (tracking view)

Rows become the same object as the map, connected:

- Each row's leading glyph becomes the **same numbered badge** as the map
  (done = muted number, next = number inside the existing animated
  `stop-next-ring` accent — red when late, upcoming = bordered number).
- A **vertical timeline rail** connects the badges — one uniform `bg-border`
  hairline (hierarchy is the badges' job; a two-tone rail adds noise, and
  "rich but calm" wins). Markup: drop the Card's `divide-y` (full-width
  hairlines would slice the rail); the marker column is `relative
  self-stretch` with an absolutely-positioned `top-0 bottom-0 w-px` rail
  behind the badge, top half suppressed on the first row, bottom half on the
  last. The done-row fade moves off the row onto the text/time content so
  badges and rail stay crisp.
- The M16 timing columns (Scheduled / Arrived+delta / projected ETA) are
  unchanged.

## Implementation map

| Piece | Change |
| --- | --- |
| `components/map/vehicle-marker.tsx` | Replace `StopMarker` with `StopDot` (fleet tier, SVG) + `StopBadge` (focus tier, DOM div — text centring is free); badge takes `number`, `state`, `late`, `etaLabel?`. `InterpolatedMarker` gains a `style` pass-through for zIndex |
| `components/map/fleet-map-view.tsx` | Marker tier chosen by `selectedId` (ordinal = `index + 1` over the van's already-seq-sorted list — no helper, YAGNI); dim non-selected route layers via conditional paint expressions (constant opacity when nothing selected — MapLibre expressions can't compare against JS `null`; the traveled layer's expression must not reference `late`, its features don't carry it); the lateness memo becomes `Map<vehicleId, Lateness>` with the `Set` for `useRouteFeatures` derived from it (signature there unchanged); `useLocale` import for the pill clock; explicit zIndex per marker tier |
| `components/console/tracking-view.tsx` | Mini-map gets `selectedId`; StopRow leading glyph → numbered badge + uniform timeline rail (drop `divide-y`, fade content not rows); timing columns untouched |
| `lib/map-theme.ts` | **Keep `pickup`/`dropoff`** — dispatch `pin-map.tsx` and history-view's replay start/end dots use them. Replace `stopDone` with badge tokens: `stopDoneFill`/`stopDoneText` (pre-mixed muted colours at full element opacity — a 55% element fade over light tiles fails contrast), `stopNextFill`/`stopNextText` (light: deep teal + white; dark: bright teal + near-black — the same text token works on the late-red fill in both themes) |
| Legend | Unchanged, decided: numbered badges and dots are self-evident; the legend keeps explaining van status only. No new i18n keys |
| i18n | No new keys (the pill is a clock time) |

**A11y notes (from review):** map badges stay `aria-hidden` (the itinerary is
the accessible surface and its numbers are real text); no new map-side
animation — the next-badge halo stays a static low-opacity shape, and the
itinerary reuses `stop-next-ring`, which already carries reduce-motion
overrides; done badges get pre-mixed muted fills at full opacity instead of an
`opacity:` fade so numbers pass contrast on light tiles.

## Non-goals

- No clustering, no zoom-dependent tiers (17 stops/van doesn't need it; the
  dot tier already handles fleet zoom).
- No symbol-layer migration — DOM markers are fine at this scale and keep the
  existing interpolation/a11y patterns.
- No itinerary information changes — M16's timing model stays as is.
- Dispatch console (`pin-map`, orders list) untouched.

## Risks / edge cases to handle

- **Ordinals vs live churn:** ordinals derive from the live seq-sorted stop
  list; a reorder renumbers instantly (correct — map and itinerary iterate
  the same array from `useLiveStops`, so they can never disagree).
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

- `pnpm exec tsc --noEmit`, `pnpm test` (existing suites — the change is
  presentational; the logic it consumes is already unit-tested), `pnpm build`.
- Visual: `pnpm dev` + fake-gps — fleet view reads as three clean lines with
  dot texture; selecting Van Bern shows numbered badges, others fade, next
  badge red with ETA pill; itinerary numbers match the map.
