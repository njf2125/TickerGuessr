# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Generate a game fixture (requires TWELVEDATA_API_KEY env var)
TWELVEDATA_API_KEY=<key> npx tsx scripts/fetch-game-data.ts 2026-07-05
```

## Architecture

**TickerGuessr** is a daily stock-guessing game (Wordle-style). Players see an anonymized candlestick chart and get up to 6 guesses; hints unlock progressively. One puzzle per calendar day, same puzzle for all players.

### Two separate ticker lists

| List | File | Size | Purpose |
|------|------|------|---------|
| Autocomplete universe | `src/data/companies.ts` | ~7,075 | What players can type — all NASDAQ+NYSE listed stocks |
| Answer pool | `src/data/puzzle-pool.ts` | ~517 | What the game picks — S&P 500 ∪ Nasdaq-100 only |

A unit test (`puzzle-pool.test.ts`) enforces that every pool ticker exists in companies.ts (the "winnability guarantee"). `puzzle-selection.ts` computes `ELIGIBLE = PUZZLE_POOL ∩ COMPANY_TICKERS` at runtime as a belt-and-suspenders safety net.

### Data pipeline (automated, no runtime API calls)

```
GitHub Actions cron (6:00 UTC daily)
  → scripts/fetch-game-data.ts
      → reads 180-day history from public/games/*.json
      → calls selectPuzzle(date, recentlyUsed) — deterministic, date-seeded
      → calls Twelve Data (OHLC time series)
      → writes public/games/YYYY-MM-DD.json
      → auto-committed → triggers Vercel deploy
```

Players fetch `/games/${date}.json` statically — zero live financial API calls at runtime.

### Puzzle selection

`src/data/puzzle-selection.ts` — pure, no I/O:
- `selectPuzzle(dateString, recentlyUsed)` → deterministic via xmur3 hash + mulberry32 PRNG seeded from the date string. Same date + same history always yields the same puzzle.
- 180-day exclusion window: `recentlyUsedTickers()` in `fetch-game-data.ts` reads `public/games/*.json` to build the exclusion set before calling `selectPuzzle`.
- `gameIdFor(dateString)` → day offset from `GAME_START_DATE = "2026-06-25"` + 1.
- `CandleInterval`: exactly `'1h' | '1d' | '1w'` — no other values.

### Ticker notation

- **App / payload**: dot notation for share classes (`BRK.B`, `BF.B`)
- **Twelve Data API calls**: same dot notation — no conversion needed (unlike the old Alpha Vantage provider, which required dashes).
- `normalizeTicker()` in the build scripts normalizes source dashes/slashes to dots.

### Twelve Data guard

Twelve Data signals errors via `{"status": "error", "message": ...}` in the JSON body. `assertNotThrottled(res)` (exported from `scripts/fetch-game-data.ts`) throws before any file write happens. Free tier does not include the `statistics`/`profile` endpoints, so `marketCapTier` is **not** fetched live — it's precomputed monthly into `puzzle-pool.ts` (see below) and read statically per puzzle.

### Market cap tiers

`marketCapTier` (used for the g3 hint in `HintContainer.tsx`) is fetched once per ticker during the monthly `build-puzzle-pool.ts` refresh via `api.nasdaq.com`'s public, keyless quote-summary endpoint (undocumented, same risk class as `build-company-list.ts`'s NASDAQ symbol-file scrape). Falls back to `"Large Cap"` per-ticker if that lookup fails for an individual symbol.

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

`.github/workflows/daily-game.yml`:
- `generate` job: runs daily at 6:00 UTC, calls `fetch-game-data.ts`, auto-commits the new JSON.
- `refresh-pool` job: runs after `generate` (serialized via `needs: generate`), first-of-month only, re-runs both build scripts and runs the winnable test before committing.
- API key injected via `env: TWELVEDATA_API_KEY: ${{ secrets.TWELVEDATA_API_KEY }}` — never interpolated directly into the `run:` shell line.

### Go-live notes

Three synthetic fixtures exist in `public/games/` (marked `"_synthetic": true`) for 2026-06-29, 2026-07-01, and 2026-07-04. Regenerate them with a real key before those dates:
```bash
npx tsx scripts/fetch-game-data.ts <date>
```
Also: `gh secret set TWELVEDATA_API_KEY` must be set for CI to function.
