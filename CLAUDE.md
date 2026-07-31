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
```

## Architecture

**TickerGuessr** is a daily stock-guessing game (Wordle-style). Players see an anonymized candlestick chart and get up to 6 guesses; hints unlock progressively. One puzzle per calendar day, same puzzle for all players.

### Two separate ticker lists

| List | File | Size | Purpose |
|------|------|------|---------|
| Autocomplete universe | `src/data/companies.ts` | ~7,075 | What players can type — all NASDAQ+NYSE listed stocks |
| Answer pool | `src/data/puzzle-pool.ts` | ~517 | What the game picks — S&P 500 ∪ Nasdaq-100 only |

A unit test (`puzzle-pool.test.ts`) enforces that every pool ticker exists in companies.ts (the "winnability guarantee"). `puzzle-selection.ts` computes `ELIGIBLE = PUZZLE_POOL ∩ COMPANY_TICKERS` at runtime as a belt-and-suspenders safety net.

### Data pipeline (currently paused — no active OHLC provider)

Daily game generation is **paused**: the prior provider (Twelve Data) does not permit publicly redistributing/caching its OHLC data long-term on a free/personal plan, which is exactly what this pipeline did (bake it into static JSON files served indefinitely). `scripts/fetch-game-data.ts` and the daily-generation GitHub Actions job have been removed until a licensing-compliant provider is chosen.

`public/games/*.json` still holds previously-generated puzzles and continues to be served statically — zero live financial API calls at runtime — but no new dates are being produced.

`src/data/puzzle-selection.ts` (`selectPuzzle`, `gameIdFor`, deterministic date-seeded PRNG) is unchanged and ready to be wired into a new fetch script once a provider is picked.

### Puzzle selection

`src/data/puzzle-selection.ts` — pure, no I/O:
- `selectPuzzle(dateString, recentlyUsed)` → deterministic via xmur3 hash + mulberry32 PRNG seeded from the date string. Same date + same history always yields the same puzzle.
- 180-day exclusion window: previously built by reading `public/games/*.json` in `fetch-game-data.ts` (now removed) before calling `selectPuzzle`; a new fetch script will need to reimplement this.
- `gameIdFor(dateString)` → day offset from `GAME_START_DATE = "2026-06-25"` + 1.
- `CandleInterval`: exactly `'1d' | '1w' | '1mo'` — no other values.

### Ticker notation

- **App / payload**: dot notation for share classes (`BRK.B`, `BF.B`)
- `normalizeTicker()` in the build scripts normalizes source dashes/slashes to dots.

### Market cap tiers

`marketCapTier` (used for the g2 hint in `HintContainer.tsx`) is fetched once per ticker during the monthly `build-puzzle-pool.ts` refresh via `api.nasdaq.com`'s public, keyless quote-summary endpoint (undocumented, same risk class as `build-company-list.ts`'s NASDAQ symbol-file scrape). Falls back to `"Large Cap"` per-ticker if that lookup fails for an individual symbol.

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

`.github/workflows/pool-refresh.yml`:
- `refresh-pool` job: runs monthly (1st of the month, 6:00 UTC), re-runs both build scripts (`build-company-list.ts`, `build-puzzle-pool.ts`) and the winnable-pool test before auto-committing via PR.
- There is no daily-generation workflow — see "Data pipeline" above.

### Resuming daily generation

To bring daily puzzle generation back:
1. Pick an OHLC data provider whose terms explicitly permit public redistribution/long-term caching of historical price data (not just live per-request display) — this was the reason Twelve Data was removed.
2. Write a new `scripts/fetch-*.ts` analogous to the old `fetch-game-data.ts`: read recent `public/games/*.json` to build the 180-day exclusion set, call `selectPuzzle`, fetch OHLC from the new provider, write `public/games/YYYY-MM-DD.json` + `-answer.json`.
3. Add a daily-cron GitHub Actions job (see git history for `daily-game.yml` prior to its removal for the auto-commit/PR pattern).
