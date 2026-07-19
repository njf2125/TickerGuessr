import { CandleInterval } from "../types/game";
import { PUZZLE_POOL } from "./puzzle-pool";
import { COMPANIES } from "./companies";
import { FAMILIAR_TICKERS } from "./familiar-tickers";

export const GAME_START_DATE = "2026-06-25";
const INTERVALS: CandleInterval[] = ["1d", "1w", "1mo"];

export interface SelectedPuzzle {
  ticker: string;
  name: string;
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
  interval: CandleInterval;
}

// Only pool entries that are actually typeable in the autocomplete are eligible.
// Hoist the company-ticker Set so it is built once, not per filter iteration.
const COMPANY_TICKERS = new Set(COMPANIES.map((c) => c.ticker));
const ELIGIBLE = PUZZLE_POOL.filter((e) => COMPANY_TICKERS.has(e.ticker));

// Prefer recognizable household names so players have a real shot at guessing;
// falls back to the full eligible pool if the familiar subset is ever empty.
const FAMILIAR_ELIGIBLE = ELIGIBLE.filter((e) => FAMILIAR_TICKERS.has(e.ticker));

// Deterministic string -> 32-bit seed (xmur3) and PRNG (mulberry32).
export function seedFrom(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayOffset(dateString: string): number {
  const start = new Date(GAME_START_DATE).getTime();
  const target = new Date(dateString).getTime();
  return Math.round((target - start) / (1000 * 60 * 60 * 24));
}

export function gameIdFor(dateString: string): number {
  return dayOffset(dateString) + 1;
}

export function selectPuzzle(dateString: string, recentlyUsed: Set<string>): SelectedPuzzle {
  const rng = mulberry32(seedFrom(dateString));
  let candidates = FAMILIAR_ELIGIBLE.filter((e) => !recentlyUsed.has(e.ticker));
  // Safety nets, in priority order: prefer a fresh (not-recently-used) pick
  // over a familiar one, since the 180-day no-repeat rule is the harder
  // guarantee — only reuse a ticker if the wider pool is also exhausted.
  if (candidates.length === 0) candidates = ELIGIBLE.filter((e) => !recentlyUsed.has(e.ticker));
  if (candidates.length === 0) candidates = FAMILIAR_ELIGIBLE;
  if (candidates.length === 0) candidates = ELIGIBLE;
  if (candidates.length === 0) {
    throw new Error("No eligible puzzle tickers — pool ∩ companies is empty.");
  }
  const entry = candidates[Math.floor(rng() * candidates.length)];
  const interval = INTERVALS[Math.floor(rng() * INTERVALS.length)];
  return {
    ticker: entry.ticker,
    name: entry.name,
    sector: entry.sector,
    marketCapTier: entry.marketCapTier,
    triviaHints: entry.triviaHints,
    interval,
  };
}
