# TickerGuessr: Progressive Chart Reveal + Visual Overhaul

## Background

The revenue-chart pivot (see `2026-07-31-revenue-chart-pivot-design.md`) replaced the
stock-price candlestick chart with a real, free, SEC-sourced quarterly revenue bar chart.
It works and is legally clean, but on a real phone screen it reads as a generic dashboard
widget rather than a game:

- **28 bars crammed into a phone-width card** — each bar is ~5px wide, and the shape is
  hard to read at a glance.
- **28 unreadable x-axis labels** (`Q1`…`Q28`) that carry *zero* information — they're
  deliberately fake sequential labels (real dates are withheld for anonymization), so
  they're pure visual noise.
- **The chart is static wallpaper.** All bars appear at guess 0 and never change. The
  actual game loop is "read text chips that appear below," so the primary visual element
  does nothing after the first second.

The mechanic also feels flatter than the old price chart. Real price charts have
viscerally recognizable shapes (crashes, spikes); quarterly revenue is slower-moving and
less dramatic. That tradeoff was accepted for legal reasons and is not being revisited —
this design makes the *presentation* carry the engagement instead.

## Goals

- Make the chart the primary reward loop: **nearly every guess changes the chart**, not just
  the text hints. (Exactly: guesses 1–4 of 5 transitions for a full-history ticker; the final
  guess is static by design, and short-history tickers reach their full history earlier — see
  §2, where the pacing is deliberate and shouldn't be "fixed" by raising the cap.)
- Make the chart legible and bold on a phone screen.
- Preserve every existing anonymization property (no real dates, no visible values until
  guess 3).
- Preserve the existing, already-tuned text-hint reveal curve — this design *adds* a
  second reward track, it doesn't re-time the existing one.

## Non-goals

- Not revisiting the data source. Real stock price data remains off the table (every free
  provider prohibits public redistribution — see the pivot design doc for the full
  vendor-by-vendor comparison). This is a presentation change, not a data change.
- Not adding new data dimensions (shares outstanding, employee count, etc.). Decided to
  first surface the existing signal better before adding more.
- Not changing the chart type to line/area. Bars are the honest encoding for discrete
  quarterly periods; a smooth line would imply continuity that quarterly data doesn't have.

## Design

### 1. Data & schema

- **Split the shared `MAX_QUARTERS_KEPT` constant into two.** Today
  `scripts/fetch-financials-data.ts` has a single `MAX_QUARTERS_KEPT = 28` applied inside
  `extractQuarterlySeries`, which is called for **both** revenue *and* net income
  (`pickPuzzleWithData` → `fetchConceptWithFallback` → `extractQuarterlySeries`). Naively
  dropping it to 12 for chart-density reasons would also silently shorten the net income
  series that `trendDirection` regresses over — turning a ~7-year profitability trend into a
  ~3-year one, which can flip the player-facing hint (a company that lost money for years and
  recently turned profitable reads "down" over 7 years but "up" over 3). That's a meaningful
  behavior change and must not happen as a side effect of a layout change.

  Therefore: `extractQuarterlySeries` takes the cap as a parameter, and callers pass
  - `MAX_REVENUE_QUARTERS = 12` for revenue (presentation — what the chart shows), and
  - `MAX_TREND_QUARTERS = 28` for net income (analysis — what the trend is computed over).

  Twelve quarters is enough to show a real growth/decline trend plus ~3 seasonal cycles, and
  it's the most that renders boldly on mobile. Twenty-eight preserves the existing net income
  hint behavior exactly, so this change is chart-only.
- **No schema change.** `revenueData: RevenuePoint[]` keeps its exact shape, just carries
  fewer entries. The `x` field (fake sequential label) stays even though the axis labels are
  being removed — keeping it costs nothing, and removing it would force a type migration and
  fixture regeneration for zero benefit.
- **Existing 28-entry fixtures must keep working.** `StockChart` slices defensively
  (`slice(-N)`), so a payload with 28 entries renders the most recent 12 correctly with no
  migration and no forced regeneration. New fixtures generated after this change carry 12.

### 2. Progressive reveal

`StockChart` receives the full `revenueData` array plus `guessCount` and derives how much to
show:

```
visibleCount = min(4 + guessCount * 2, 12, data.length)
```

- g0 → 4 bars, g1 → 6, g2 → 8, g3 → 10, g4 → 12 (full), g5 → 12.

  **The step size is 2, not 4, and that's load-bearing.** `MAX_ATTEMPTS` is 6, so
  `guessCount` runs 0–5 during play. A step of 4 would reach the 12-cap at guess 2, leaving
  the chart frozen for guesses 2–5 — four of six stages — which reintroduces the exact
  "static wallpaper" problem this design exists to eliminate, just delayed, and does so
  precisely when the game gets hard and engagement matters most. A step of 2 changes the
  chart at g1/g2/g3/g4, leaving only the final guess static.

- Reveals **backwards in time**: always show the *most recent* `visibleCount` quarters, with
  older history filling in leftward. Two reasons: recent performance is the most
  identifiable signal, and the rightmost (newest) bars never shift position as more appear,
  so the reveal reads as "more context added" rather than "everything moved."
- **Short-history tickers:** `MIN_USABLE_QUARTERS` is 8, so a ticker can legitimately have
  only 8–11 quarters of data (recent-ish IPOs that still cleared the minimum). The
  `data.length` term in the formula clamps to what actually exists, so such a ticker simply
  reaches its full history earlier (an 8-quarter ticker is fully revealed at g2) rather than
  rendering empty slots. The visible-history indicator copy must read correctly in that case
  too.

**Color stability (important correctness detail):** bar color is green when that quarter's
revenue is ≥ the *previous* quarter's, red otherwise. The comparison must use the previous
quarter from the **full** array, not from the visible slice. Otherwise the leftmost visible
bar has no predecessor and would flip color as soon as more bars are revealed — colors must
be stable across reveals.

A deliberate consequence: the leftmost visible bar's color is determined by a quarter the
player can't see yet. This is the right tradeoff — stable colors that never change under the
player beat colors they could verify but which mutate on every reveal — but it is a choice,
not an oversight. The very first bar of the *full* array (no predecessor at all) defaults to
green.

### 3. Visual treatment

- **Remove x-axis labels entirely.** They're fake, unreadable at this density, and carry no
  information.
- Chart height 260 → 300; rounded bar caps; wider `columnWidth` (bars are bold now that
  there are ≤12).
- **Re-enable ApexCharts animations** (currently `animations: { enabled: false }`) so newly
  revealed bars animate in. This is what makes a reveal feel like a reward rather than a
  redraw. Note: animations were originally disabled during the candlestick era; there is no
  documented reason recorded for that, so this is a deliberate reversal, not an oversight —
  if it causes flicker on re-render it should be revisited rather than silently left on.
- Card header row shows "Quarterly Revenue" plus a subtle indicator of how much history is
  currently visible (e.g. "last 8 quarters"), so the progressive reveal is legible to the
  player rather than mysterious.

### 4. Anonymization properties that must survive (regression risks)

These are load-bearing and were each deliberate decisions in prior work:

- `dataLabels: { enabled: false }` — bar charts default to printing values *on* each bar,
  which would leak exact revenue regardless of guess count.
- `yaxis.labels.show: false` — no value scale before guess 3.
- Tooltip stays gated at `guessCount >= 3`.
- No real dates anywhere in the payload or UI (the `x` labels are synthetic; this is why
  removing the axis labels is safe and in fact reduces surface area).

## Testing

- `StockChart` has no existing test file. Add unit coverage for the pure reveal logic —
  extract `visibleQuarterCount(guessCount, dataLength)` and the color-assignment helper as
  exported pure functions so they're testable without rendering ApexCharts (which requires a
  DOM and is dynamically imported with `ssr: false`). Note the signature takes **both**
  arguments: the `data.length` clamp for short-history tickers is part of this function, not
  a separate concern at the call site.
- Cases worth covering: reveal counts at each of g0–g5 (4/6/8/10/12/12); cap at 12 never
  exceeded; a 28-entry legacy payload renders the most recent 12; an 8-entry (short-history)
  payload never requests more than it has; color of a given quarter is identical at g0 and
  g4 (stability across reveals); the full array's first bar defaults to green.
- `extractQuarterlySeries` gains a cap parameter — add a test that the same input series
  yields 12 entries when called with `MAX_REVENUE_QUARTERS` and 28 with `MAX_TREND_QUARTERS`,
  so the revenue/net-income decoupling can't silently regress back to a shared constant.
- Existing test suites (38 tests) must stay green. Existing `extractQuarterlySeries` tests
  use short (8–9 entry) fixtures that never reach either cap, so they're unaffected by the
  signature change beyond passing the new argument.

## Migration

- Live fixtures (`public/games/*.json`) currently carry 28 entries. They render correctly
  under the new component without regeneration (defensive slice). The next daily cron run
  produces 12-entry payloads naturally. No manual migration step, no forced downtime.

## Open questions for implementation

- Exact copy for the visible-history indicator ("last 8 quarters" vs. "3 years" vs. a
  progress dot row).
- Whether the animation on reveal should be a grow-from-baseline or a fade-in — worth
  eyeballing both in the running app, since this is the single detail most responsible for
  whether the reveal feels rewarding.
