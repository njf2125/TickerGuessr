# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Next.js dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm test             # Vitest (all test files, run once)
npm run test:watch   # Vitest in watch mode

# Run a single test file
npx vitest run src/data/puzzle-selection.test.ts

# Type-check everything (includes scripts/ — tsconfig include = **/*.ts)
npx tsc --noEmit

# Regenerate autocomplete universe (~7,075 tickers from NASDAQ/NYSE symbol files)
npx tsx scripts/build-company-list.ts

# Regenerate answer pool (~517 tickers from Wikipedia S&P 500 + Nasdaq-100)
npx tsx scripts/build-puzzle-pool.ts

# Generate a game fixture (no API key needed — SEC EDGAR is keyless)
npx tsx scripts/fetch-financials-data.ts 2026-08-05
```

## Architecture

**TickerGuessr** is a daily stock-guessing game (Wordle-style). Players see an anonymized quarterly revenue chart and get up to 6 guesses; hints unlock progressively. One puzzle per calendar day, same puzzle for all players.

### Two separate ticker lists

| List | File | Size | Purpose |
|------|------|------|---------|
| Autocomplete universe | `src/data/companies.ts` | ~7,075 | What players can type — all NASDAQ+NYSE listed stocks |
| Answer pool | `src/data/puzzle-pool.ts` | ~517 | What the game picks — S&P 500 ∪ Nasdaq-100 only |

A unit test (`puzzle-pool.test.ts`) enforces that every pool ticker exists in companies.ts (the "winnability guarantee"). `puzzle-selection.ts` computes `ELIGIBLE = PUZZLE_POOL ∩ COMPANY_TICKERS` at runtime as a belt-and-suspenders safety net.

### Data pipeline (automated, no runtime API calls)

```
GitHub Actions cron (6:00 UTC daily)
  → scripts/fetch-financials-data.ts
      → reads data/ticker-history.json for the 180-day exclusion set
      → calls selectPuzzle(date, recentlyUsed) — deterministic, date-seeded
      → looks up the ticker's CIK via SEC's company_tickers.json
      → fetches quarterly revenue + net income from SEC EDGAR's XBRL API
      → writes public/games/YYYY-MM-DD.json + -answer.json
      → appends {date, ticker} to data/ticker-history.json
      → prunes public/games/ down to just today + tomorrow
      → auto-committed → triggers Vercel deploy
```

Players fetch `/games/${date}.json` statically — zero live financial API calls at runtime.

SEC EDGAR is free, public-domain, government-sourced data with no vendor and no
redistribution restriction — this replaced Twelve Data (removed for exactly that
restriction) and, before it, an evaluation of Polygon.io, yfinance/Yahoo Finance,
Alpha Vantage, Tiingo, and Stooq, all of which restrict free-tier redistribution
for the same structural reason. See
`docs/superpowers/specs/2026-07-31-revenue-chart-pivot-design.md` for the full
comparison.

### Data retention (public/games is a rolling window, not an archive)

No feature ever fetches a puzzle by date other than "today" (`useGameState(TODAY)` in `src/app/page.tsx`) — there's no replay/archive UI, and `gameId` is only a display number. So once a day passes, its file has no product purpose — keeping it around is just an ever-growing archive with no upside (this policy predates the SEC EDGAR data source; it was originally about not indefinitely redistributing licensed OHLC data, and is kept now as good hygiene). Retention policy:

- `public/games/` holds **only the current day's puzzle plus at most one day ahead** (a pre-generated "tomorrow," if one exists) — never a running archive.
- `data/ticker-history.json` (outside `public/`, never served) holds the full `{date, ticker}` history needed for the 180-day repeat-ticker exclusion window in `selectPuzzle` — no price data, just enough to avoid repeats.
- Whenever a new fetch script runs: append that day's `{date, ticker}` to `data/ticker-history.json`, write the new day's file into `public/games/`, and delete the previous day's file(s) from `public/games/` once they're no longer "today" or "tomorrow."

### Puzzle selection

`src/data/puzzle-selection.ts` — pure, no I/O:
- `selectPuzzle(dateString, recentlyUsed)` → deterministic via xmur3 hash + mulberry32 PRNG seeded from the date string. Same date + same history always yields the same puzzle.
- 180-day exclusion window: `recentlyUsedTickers()` in `fetch-financials-data.ts` reads `data/ticker-history.json` (not `public/games/`) to build the exclusion set before calling `selectPuzzle`.
- `gameIdFor(dateString)` → day offset from `GAME_START_DATE = "2026-06-25"` + 1.

### Ticker notation

- **App / payload**: dot notation for share classes (`BRK.B`, `BF.B`)
- `normalizeTicker()` in the build scripts normalizes source dashes/slashes to dots.
- **SEC's `company_tickers.json`**: dash notation (`BRK-B`), like the old Alpha Vantage provider — `lookupCik()` in `fetch-financials-data.ts` converts dots to dashes before matching. This exact class of bug (a provider using different notation than the app) has bitten this project before; `lookupCik`'s test coverage includes a dotted-ticker case specifically because of that history.

### Market cap tiers

`marketCapTier` (used for the g2 hint in `HintContainer.tsx`) is **not** fetched live. `build-puzzle-pool.ts` carries the tier forward from the previous pool build for tickers already in the pool; a ticker new to the pool defaults to `"Large Cap"` (S&P 500 / Nasdaq-100 membership already implies large/mega cap). This replaced a prior `api.nasdaq.com` undocumented quote-summary lookup, which was fragile and unlicensed.

### SEC EDGAR data source

`scripts/fetch-financials-data.ts` fetches quarterly revenue and net income from
SEC EDGAR's XBRL company-concept API (`data.sec.gov`), using a fallback tag list
for revenue (companies use different tags across years/industries — see the tag
list in the script) and `NetIncomeLoss` for net income. Every request sends a
descriptive `User-Agent` per SEC's fair-access policy. Throttling is signaled via
HTTP 403/429, not a JSON error body.

A ticker with no usable SEC data (recent IPO with too few filings, or a foreign
private issuer filing annual 20-F instead of quarterly 10-Q) triggers a
retry-and-reselect loop rather than failing the whole run — see
`pickPuzzleWithData` in the script.

Revenue and net income values from SEC's API mix true single-quarter figures
with cumulative year-to-date figures under the same tag — `extractQuarterlySeries`
filters to true single-quarter spans (80–100 day range) and deduplicates
restated periods before use. This was a real bug caught during design review, not
a hypothetical — see the spec doc for the live-data verification.

### Client-side state

`src/hooks/useGameState.ts` — single hook driving the whole game:
- Fetches `GameDayPayload` from `/games/${dateString}.json`
- Persists `PersistedGameState` (guesses + status) in localStorage per date
- Persists `PlayerStats` in localStorage (key: `tickerguessr_stats`)
- `submitGuess()` triggers terminal state transitions; `justFinished` is only true on the transition turn (not on refresh)

### Scripts and `@/` aliases

`tsx` cannot resolve `@/` path aliases. All modules transitively imported by scripts must use **relative imports** (e.g., `../types/game`, `./puzzle-pool`). The `src/data/` files use relative imports for this reason.

`tsconfig.json` includes `**/*.ts` (only `node_modules` excluded), so `npx tsc --noEmit` typechecks `scripts/` too. Deleting or renaming a type imported by a script will break `tsc`.

### CI

`.github/workflows/daily-financials.yml`:
- `generate` job: runs daily at 6:00 UTC, calls `fetch-financials-data.ts`, auto-commits the new JSON + ticker history.

`.github/workflows/pool-refresh.yml`:
- `refresh-pool` job: runs monthly (1st of the month, 6:00 UTC), re-runs both build scripts (`build-company-list.ts`, `build-puzzle-pool.ts`) and the winnable-pool test before auto-committing via PR.
