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
  `Revenues`, `SalesRevenueNet` — use whichever yields the most usable quarterly (`form:
  "10-Q"`) data points, since companies have changed tags over the years as GAAP evolved.
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
across all fallback tags (e.g., too new to have SEC history, or an unusual filer type), the
fetch script adds it to the `recentlyUsed` exclusion set passed into `selectPuzzle` and
re-calls it to get a different candidate, repeating until one with usable data is found (or
a small retry cap is hit, at which point the run fails loudly rather than silently degrading
— consistent with the existing `assertNotThrottled`-style fail-fast pattern). If this
retry-and-reselect happens often enough to matter, a future pass could pre-filter the pool at
`build-puzzle-pool.ts` time instead — deferred until observed in practice.

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

## Open questions for implementation time

- Exact wording/emoji for the net income hint chip.
- Whether "too few usable quarters" tickers should be pre-filtered at pool-build time rather
  than handled per-day (deferred until it's observed to matter in practice).
- **Unverified assumption**: revenue charts may not be as visually distinctive as price
  charts across the whole pool. Only 2 tickers were spot-checked (AAPL, WY) during design —
  both showed real variation, and quarterly seasonality (e.g. retail Q4 spikes) likely gives
  many companies a genuinely distinctive sawtooth-vs-smooth-growth character, but mature,
  stable companies (utilities, insurers) may produce fairly flat, unremarkable shapes
  compared to a volatile price chart. Worth spot-checking a wider sample from the actual pool
  before committing to this as the sole chart mechanic — if it's a real problem, Approach 2
  (layering in a second metric) becomes more important sooner rather than a stretch goal.
- **Unverified assumption**: net income's "trending up/down" simplification may be
  misleading for companies with lumpy net income (one-time charges, tax effects) that don't
  reflect the underlying business trend. Not validated against real data yet.
