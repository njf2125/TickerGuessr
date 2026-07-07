import { describe, it, expect } from "vitest";
import { selectPuzzle, gameIdFor, GAME_START_DATE } from "./puzzle-selection";

describe("selectPuzzle", () => {
  it("is deterministic for a given date + history", () => {
    const a = selectPuzzle("2026-07-01", new Set());
    const b = selectPuzzle("2026-07-01", new Set());
    expect(a).toEqual(b);
  });

  it("different dates generally yield different tickers", () => {
    const picks = new Set(
      ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"].map(
        (d) => selectPuzzle(d, new Set()).ticker
      )
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("never selects a ticker in the recently-used set", () => {
    const first = selectPuzzle("2026-07-01", new Set()).ticker;
    const next = selectPuzzle("2026-07-01", new Set([first]));
    expect(next.ticker).not.toBe(first);
  });

  it("returns a valid interval", () => {
    const p = selectPuzzle("2026-07-09", new Set());
    expect(["1d", "1w", "1mo"]).toContain(p.interval);
  });

  it("gameId is day-offset + 1 from the start date", () => {
    expect(gameIdFor(GAME_START_DATE)).toBe(1);
    expect(gameIdFor("2026-06-26")).toBe(2);
  });
});
