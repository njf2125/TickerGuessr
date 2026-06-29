import { describe, it, expect } from "vitest";
import { PUZZLE_POOL } from "./puzzle-pool";
import { COMPANIES } from "./companies";

const TICKERS = new Set(COMPANIES.map((c) => c.ticker));

describe("puzzle-pool", () => {
  it("has more than 180 entries (so the 180-day no-repeat rule never runs dry)", () => {
    expect(PUZZLE_POOL.length).toBeGreaterThan(180);
  });

  it("every pool ticker exists in companies.ts (winnable)", () => {
    const missing = PUZZLE_POOL.filter((e) => !TICKERS.has(e.ticker)).map((e) => e.ticker);
    expect(missing, `pool tickers missing from companies.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no duplicate tickers", () => {
    const seen = new Set(PUZZLE_POOL.map((e) => e.ticker));
    expect(seen.size).toBe(PUZZLE_POOL.length);
  });
});
