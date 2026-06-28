import { CandleInterval } from "../types/game";

export interface ScheduleEntry {
  ticker: string;
  interval: CandleInterval;
}

export const GAME_START_DATE = "2026-06-25";

export const GAME_SCHEDULE: ScheduleEntry[] = [
  { ticker: "AAPL", interval: "1d" },  // Game 1
  { ticker: "TSLA", interval: "1w" },  // Game 2
  { ticker: "NVDA", interval: "1d" },  // Game 3
  // Continue adding entries. Each entry = one calendar day of puzzles.
  // Run scripts/build-company-list.ts to get the full filtered ticker pool,
  // then pick from it for variety and difficulty balance.
];

// Self-contained fallback pool — all well-known large/mega caps that survive
// the companies.ts screen, so a fallback puzzle is always winnable. Used only
// after GAME_SCHEDULE runs out. Inlined (no COMPANIES import) so this module
// stays resolvable under tsx. Keep these tickers present in companies.ts.
const FALLBACK_POOL: ScheduleEntry[] = [
  { ticker: "AAPL", interval: "1d" },
  { ticker: "MSFT", interval: "1d" },
  { ticker: "AMZN", interval: "1w" },
  { ticker: "GOOGL", interval: "1d" },
  { ticker: "META", interval: "1d" },
  { ticker: "NVDA", interval: "1w" },
  { ticker: "JPM", interval: "1d" },
  { ticker: "V", interval: "1d" },
  { ticker: "WMT", interval: "1w" },
  { ticker: "KO", interval: "1d" },
  { ticker: "DIS", interval: "1d" },
  { ticker: "NKE", interval: "1w" },
  { ticker: "MCD", interval: "1d" },
  { ticker: "COST", interval: "1d" },
  { ticker: "PEP", interval: "1w" },
  { ticker: "XOM", interval: "1d" },
  { ticker: "CAT", interval: "1d" },
  { ticker: "BA", interval: "1w" },
  { ticker: "NFLX", interval: "1d" },
  { ticker: "SBUX", interval: "1d" },
];

function dayIndexFor(dateString: string): number {
  const start = new Date(GAME_START_DATE);
  const target = new Date(dateString);
  return Math.round(
    (target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
  );
}

export function getScheduleEntry(dateString: string): ScheduleEntry {
  const dayIndex = dayIndexFor(dateString);

  if (dayIndex >= 0 && dayIndex < GAME_SCHEDULE.length) {
    return GAME_SCHEDULE[dayIndex];
  }

  // Deterministic fallback: same dayIndex always yields the same entry.
  const i =
    ((dayIndex % FALLBACK_POOL.length) + FALLBACK_POOL.length) % FALLBACK_POOL.length;
  return FALLBACK_POOL[i];
}
