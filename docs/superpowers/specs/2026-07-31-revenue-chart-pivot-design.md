# TickerGuessr: Revenue-Chart Pivot Design

## Background

TickerGuessr's daily puzzle previously showed a candlestick chart of real historical stock
price (OHLC) data, sourced from Twelve Data. That integration was removed (see git history
and `CLAUDE.md`) because Twelve Data's free/personal terms prohibit publicly redistributing
or long-term caching of their data — exactly what publishing it as static
`public/games/YYYY-MM-DD.json` files did.

A survey of alternative OHLC providers (Polygon.io free tier, yfinance/Yahoo Finance,
Alpha Vantage, Tiingo, Stooq) found the same restriction in every case: free tiers exist
specifically to exclude public redistribution, because licensed redistribution rights are
the vendors' business model. Normalizing price into a percentage-change series, or
switching chart type (candlestick → line), does not avoid this — the restriction covers
"any data obtained from the service, in whole or in part," including derived series that
can be reverse-engineered back to the underlying price (confirmed via exchange market-data
policy language, e.g. LSE's).

Given real stock price data cannot be both free and zero-risk while running a public site,
this design **replaces real stock price with real SEC-filed financial data** — genuinely
free, zero-risk, and public domain (U.S. government/regulatory filings), with no vendor in
the chain at all.

## Goals

- Preserve the core game: daily puzzle, 6 guesses, progressive hints, same brand
  (TickerGuessr), same answer pool (S&P 500 ∪ Nasdaq-100).
- Replace the price-chart guessing mechanic with a **real, recognizable quarterly revenue
  chart**, sourced from SEC EDGAR's XBRL API — free and legally clean indefinitely.
- Add **net income trend** as a new hint (directional, not a second chart), giving a second
  real financial signal without a second visual component.
- Keep the existing anonymization instinct: hide exact values/labels so a savvy player can't
  trivially identify a company from a memorable number, same as the old chart hid real dates.

## Non-goals

- Not attempting to preserve real stock price data in any form (ruled out — see Background).
- Not building a second chart for net income (a directional badge is sufficient — see
  Hints section).
- Not re-deriving market cap as a chart dimension — market cap = shares outstanding × price,
  so charting it over time would let anyone trivially reconstruct the real price series it's
  built from. This applies the same restriction to a derived metric, not a new one.
- Not attempting zero interruption — the two currently-live price-data fixtures
  (`2026-07-31`, `2026-08-01`) are incompatible with the new schema and will be replaced;
  the site may show no puzzle for a day or two during cutover.

## Data source

**Ticker → CIK lookup**: SEC's `company_tickers.json`
(`https://www.sec.gov/files/company_tickers.json`) — official, public, keyless mapping.
Fetched once per pool refresh (or cached), not per-puzzle.

**Per-company quarterly facts**: SEC EDGAR XBRL company-concept API —
`https://data.sec.gov/api/xbrl/companyconcept/CIK{10-digit-cik}/us-gaap/{tag}.json`

- Revenue: try tags in priority order — `RevenueFromContractWithCustomerExcludingAssessedTax`,
  `Revenues`, `SalesRevenueNet`, `SalesRevenueGoodsNet`, `SalesRevenueServicesNet`,
  `InterestAndDividendIncomeOperating` (for banks/insurers, which often don't use a generic
  "Revenues" tag at all) — use whichever yields the most usable quarterly data points, since
  companies have changed tags over the years as GAAP evolved and different industries favor
  different tags. Validated against a 25-ticker sample spanning all 13 pool sectors: the
  original 3-tag list alone covered 21/25 (84%); `ARE` and `APA` specifically needed a wider
  tag list (real companies, just tagged differently) — the 6-tag list above is expected to
  close most of that gap, though it hasn't been re-validated with the wider list yet.
- Net income: `NetIncomeLoss` (far more consistently tagged; no fallback list needed in v1,
  but the fetch helper should be written to accept a tag list for consistency and future
  extension).
- **Single-quarter filtering (critical, verified via live data)**: SEC's companyconcept API
  returns every historical filing's reported value for a tag, including both true
  single-quarter figures and cumulative year-to-date figures reported in later quarters'
  10-Qs, all under the same tag/form. Spot-checked live against AAPL's data: 80 raw
  `form:"10-Q"` entries collapse to only 45 *unique* `(start, end)` periods once verified —
  meaning roughly half the raw entries are YTD/multi-quarter spans, not single quarters.
  Naively sorting by period end date without filtering would mix 1-quarter and 2-3-quarter
  cumulative values in the same series, producing a chart with meaningless, inconsistent bar
  heights. The fetch helper must filter to entries where `end - start` is approximately one
  quarter (~80–100 days) before anything else.
- **Deduplication**: even after single-quarter filtering, the same `(start, end)` period can
  still appear more than once across multiple filings (restatements, corrections). Dedupe by
  `(start, end)`, keeping the value from the most recently `filed` entry (the latest-known,
  most-corrected figure) for that period.
- Take the most recent ~24–30 quarters after filtering and deduping (mirrors the old "30
  bars"), sorted chronologically by period end date.

**Compliance**: every request includes a descriptive `User-Agent` per SEC's fair-access
policy (`TickerGuessrBot/1.0 (https://tickerguessr.app)`), same pattern already used for the
Wikipedia Action API fetch in `build-puzzle-pool.ts`. SEC's stated rate limit is ~10
req/sec; this pipeline does 1 ticker/day, far under that.

**Throttling/errors**: SEC signals rate-limiting via HTTP status codes (403/429), not a JSON
error body (unlike the old Twelve Data `assertNotThrottled` pattern) — the fetch helper
must check `res.statusCode` directly.

**Missing-data handling**: if the ticker `selectPuzzle` picks has no usable revenue data
across all fallback tags, the fetch script adds it to the `recentlyUsed` exclusion set passed
into `selectPuzzle` and re-calls it to get a different candidate, repeating until one with
usable data is found (or a small retry cap is hit, at which point the run fails loudly rather
than silently degrading — consistent with the existing `assertNotThrottled`-style fail-fast
pattern). Two real cases confirmed during validation (25-ticker sample):
- **Recent IPOs** (e.g. a company that just went public) have too few quarterly filings on
  record yet for a usable 24–30 quarter chart. This will recur — new constituents join the
  pool periodically (the monthly `build-puzzle-pool.ts` refresh already handles Nasdaq-100/
  S&P 500 turnover) — so the retry path isn't a rare edge case, it's expected to fire
  regularly.
- **Foreign private issuers** (e.g. `ARM`) file annual Form 20-F rather than quarterly 10-Qs,
  so they structurally lack the quarterly granularity this design needs, not just missing
  tags. If this turns out to affect enough pool tickers, excluding foreign private issuers
  from the pool at `build-puzzle-pool.ts` time (rather than discovering it via retry every
  time they're selected) may be worth doing proactively — deferred until observed in
  practice, same as the general pre-filtering question below.

## Output schema (`public/games/YYYY-MM-DD.json`)

Replaces `candlestickData: OHLCPoint[]` with:

```ts
interface RevenuePoint {
  x: string;       // fake sequential period label (e.g. "Q1"), NOT the real filing quarter
  y: number;        // revenue value, real, but not shown to the player until solved/hover
}

interface GameDayPayload {
  gameId: number;
  dateString: string;
  firstLetter: string;
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
  revenueData: RevenuePoint[];       // was candlestickData
  netIncomeTrend: "up" | "down";     // new hint field
  // interval/CandleInterval field is dropped — quarterly cadence only, no daily/weekly/monthly choice
}
```

`GameDayAnswer` (ticker, companyName) is unchanged.

Anonymization: `x` labels are fake sequential quarter labels generated deterministically
from the puzzle seed (same spirit as the old `fakeDateSeries`, simplified since quarterly
cadence has no interval choice to preserve). `y` values are real but not displayed as axis
labels/gridline values by default — same principle as hiding real price levels before.

## Frontend changes

**`StockChart.tsx`**:
- ApexCharts `type: "candlestick"` → `type: "bar"`.
- Series data maps from `revenueData` instead of `candlestickData`.
- Bar color: green if that quarter's revenue ≥ previous quarter's, red otherwise (echoes the
  old candle up/down color language).
- Y-axis labels hidden by default; hover tooltip reveals exact values at `guessCount >= 3`,
  unchanged from current behavior.
- X-axis shows the fake sequential quarter labels, not real quarter/year.
- `CandleInterval`/`INTERVAL_LABELS` concept is removed — no daily/weekly/monthly choice for
  a quarterly-cadence metric.

**`HintContainer.tsx`**:
- Add a new hint chip for `netIncomeTrend`, revealed at **g2** alongside `marketCapTier`
  (both are quick numeric/directional facts) — e.g. "📈 Net income trending up" /
  "📉 Net income trending down".
- Trend calculation: use a linear regression slope over the net income series, not a
  first-half-vs-second-half average. Validation found several real companies with a third or
  more of their quarters showing a net loss while still trending up overall (e.g. one sample
  ticker had losses in 9 of 28 quarters) — a simple 2-bucket average is more exposed to being
  thrown off by a handful of lumpy one-time-charge quarters than a regression slope over the
  whole series.
- Existing reveal order otherwise unchanged: sector (g1), market cap + net income (g2),
  trivia[0] (g3), trivia[1] (g4), first letter (g5).

**`HowToModal.tsx`**: copy update — "candlestick chart" → "revenue chart" (or similar),
and the hint list needs the net income mention added.

**`src/types/game.ts`**: schema changes above ripple through here first.

## Script/CI changes

- `scripts/fetch-financials-data.ts` is the new script, replacing the removed
  `fetch-game-data.ts` (Twelve Data version):
  reads `data/ticker-history.json` for the 180-day exclusion set, calls `selectPuzzle`,
  fetches revenue + net income from SEC EDGAR, writes `public/games/YYYY-MM-DD.json` +
  `-answer.json`, appends to `data/ticker-history.json`, prunes old public files (per the
  existing retention policy in `CLAUDE.md`).
- Daily-cron GitHub Actions job re-added (was removed alongside Twelve Data), following the
  same auto-commit/PR pattern documented in `CLAUDE.md`'s "Resuming daily generation"
  section.
- `CLAUDE.md`/`AGENTS.md` updated throughout to describe the new data source in place of
  Twelve Data references.

## Testing

- New unit tests for the SEC fetch helper: tag-fallback selection (pick the tag with the
  most usable quarters), **single-quarter-span filtering (reject YTD/cumulative entries)**,
  **deduplication by period keeping the latest-filed value**, quarter sorting/slicing, and
  throttling detection via HTTP status. The single-quarter-filtering and dedup logic is the
  highest-risk part of this pipeline (caught a real bug here during spec review — see Data
  source section) and needs the most test coverage of anything in this design.
- Update `StockChart.tsx`/`HintContainer.tsx` tests (if any exist) and any type-level tests
  for the new payload shape.
- `puzzle-pool.test.ts` (winnability guarantee) is unaffected — it's about the ticker pool,
  not chart data.

## Migration

- The two currently-live fixtures (`2026-07-31.json`, `2026-08-01.json`) are stock-price
  data under the old schema — they'll be deleted/regenerated under the new schema once the
  new pipeline is in place. No attempt is made to backfill or convert them.
- `data/ticker-history.json` needs no changes — it's schema-agnostic (just `{date,
  ticker}`).

## Validation performed during design

Ran the actual single-quarter-filter + dedup logic (see Data source section) against a live
25-ticker sample spanning all 13 pool sectors, not just the 2 tickers spot-checked earlier:

- **Distinctiveness**: only 2 of 21 tickers with usable data (`CMCSA`, `CHTR` — both
  cable/telecom, steady subscription revenue) came back visually flat. Every other sector,
  including ones expected to be boring (utilities showed the *most* quarter-to-quarter
  direction changes of any sector in the sample, due to real seasonal demand), showed genuine
  shape variety. This substantially de-risks the original distinctiveness concern — it's a
  real but minor effect (~10% of tickers), not a pervasive problem requiring a second metric
  from day one.
- **Data coverage**: 21 of 25 tickers (84%) had usable revenue data with the original 3-tag
  fallback list; the tag list has since been widened to 6 tags (see Data source section) to
  close some of that gap, though the wider list hasn't been re-validated yet.
- **Net income reliability**: genuinely noisy for some tickers (see Hints section) — informed
  the switch to a regression-slope trend calculation instead of a 2-bucket average.

## Open questions for implementation time

- Exact wording/emoji for the net income hint chip.
- Whether "too few usable quarters" tickers (recent IPOs, foreign private issuers) should be
  pre-filtered at pool-build time rather than handled per-day via retry — deferred until
  observed frequency in practice makes the retry path a real cost (recent-IPO turnover is
  expected to make this a recurring case, not a rare edge case).
- Re-validate data coverage with the widened 6-tag revenue fallback list before implementation
  is considered done, to confirm `ARE`/`APA`-style gaps are actually closed.
