// Console polling cadences. The live tick drives staleness re-evaluation and
// route-feature recompute; the clock tick only refreshes the wall clock.
export const LIVE_TICK_MS = 5000
export const CLOCK_TICK_MS = 30_000
