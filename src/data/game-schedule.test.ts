import { describe, it, expect } from "vitest";
import { GAME_SCHEDULE, getScheduleEntry, GAME_START_DATE } from "./game-schedule";
import { COMPANIES } from "./companies";

const TICKERS = new Set(COMPANIES.map((c) => c.ticker));

describe("game-schedule", () => {
  it("every curated ticker exists in companies.ts (winnable)", () => {
    for (const entry of GAME_SCHEDULE) {
      expect(
        TICKERS.has(entry.ticker),
        `${entry.ticker} missing from companies.ts`
      ).toBe(true);
    }
  });

  it("resolves index 0 to the first curated entry on the start date", () => {
    expect(getScheduleEntry(GAME_START_DATE)).toEqual(GAME_SCHEDULE[0]);
  });

  it("never returns null — falls back past the end of the schedule", () => {
    const entry = getScheduleEntry("2099-01-01");
    expect(entry).toBeTruthy();
    expect(
      TICKERS.has(entry.ticker),
      `fallback ${entry.ticker} missing from companies.ts`
    ).toBe(true);
  });

  it("fallback is deterministic for a given date", () => {
    expect(getScheduleEntry("2099-01-01")).toEqual(getScheduleEntry("2099-01-01"));
  });
});
