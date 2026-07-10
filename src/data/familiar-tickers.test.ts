import { describe, it, expect } from "vitest";
import { FAMILIAR_TICKERS } from "./familiar-tickers";
import { PUZZLE_POOL } from "./puzzle-pool";

const POOL_TICKERS = new Set(PUZZLE_POOL.map((e) => e.ticker));

describe("familiar-tickers", () => {
  it("every familiar ticker exists in puzzle-pool.ts", () => {
    const missing = Array.from(FAMILIAR_TICKERS).filter((t) => !POOL_TICKERS.has(t));
    expect(missing, `familiar tickers missing from puzzle-pool.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("has enough entries for reasonable variety", () => {
    // selectPuzzle falls back to the full eligible pool if this set is ever
    // exhausted by the 180-day no-repeat window, so this isn't a hard floor.
    expect(FAMILIAR_TICKERS.size).toBeGreaterThan(100);
  });
});
