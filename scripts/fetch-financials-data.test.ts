import { describe, it, expect } from "vitest";
import {
  isSingleQuarterSpan,
  dedupeByPeriod,
  extractQuarterlySeries,
  trendDirection,
  SecFactUnit,
} from "./fetch-financials-data";

function makeUnit(start: string, end: string, val: number, filed = end, form = "10-Q"): SecFactUnit {
  return { start, end, val, filed, form };
}

describe("isSingleQuarterSpan", () => {
  it("accepts a true single-quarter span", () => {
    expect(isSingleQuarterSpan("2018-09-30", "2018-12-29")).toBe(true);
  });

  it("rejects a multi-quarter (year-to-date) span", () => {
    // matches a real shape found in AAPL's live SEC data during design validation
    expect(isSingleQuarterSpan("2018-09-30", "2019-06-29")).toBe(false);
  });
});

describe("dedupeByPeriod", () => {
  it("keeps the most recently filed value for a duplicated period", () => {
    const units: SecFactUnit[] = [
      makeUnit("2018-09-30", "2018-12-29", 100, "2019-01-30"),
      makeUnit("2018-09-30", "2018-12-29", 105, "2019-05-01"),
    ];
    const result = dedupeByPeriod(units);
    expect(result).toHaveLength(1);
    expect(result[0].val).toBe(105);
  });
});

describe("extractQuarterlySeries", () => {
  it("filters out YTD spans and returns only single-quarter values, sorted", () => {
    const units = [
      makeUnit("2018-09-30", "2018-12-29", 100),
      makeUnit("2018-09-30", "2019-06-29", 999), // YTD span, must be excluded
      makeUnit("2018-12-30", "2019-03-30", 110),
      makeUnit("2019-03-31", "2019-06-29", 120),
      makeUnit("2019-06-30", "2019-09-28", 130),
      makeUnit("2019-09-29", "2019-12-28", 140),
      makeUnit("2019-12-29", "2020-03-28", 150),
      makeUnit("2020-03-29", "2020-06-27", 160),
      makeUnit("2020-06-28", "2020-09-26", 170),
    ];
    const result = extractQuarterlySeries(units);
    expect(result).not.toBeNull();
    expect(result!.map((u) => u.val)).toEqual([100, 110, 120, 130, 140, 150, 160, 170]);
  });

  it("returns null when there are fewer than 8 usable quarters", () => {
    const units = [makeUnit("2018-09-30", "2018-12-29", 100)];
    expect(extractQuarterlySeries(units)).toBeNull();
  });
});

describe("trendDirection", () => {
  it("detects an upward trend even with some down quarters", () => {
    // mimics a real lumpy-but-growing series found during design validation
    const values = [10, 8, 12, 9, 15, 11, 18, 14, 22];
    expect(trendDirection(values)).toBe("up");
  });

  it("detects a downward trend", () => {
    const values = [100, 95, 90, 85, 80, 75, 70];
    expect(trendDirection(values)).toBe("down");
  });
});
