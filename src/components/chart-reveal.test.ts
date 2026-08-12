import { describe, it, expect } from "vitest";
import {
  visibleQuarterCount,
  visibleSlice,
  barColorsForVisible,
  MAX_VISIBLE_QUARTERS,
  UP_COLOR,
  DOWN_COLOR,
} from "./chart-reveal";
import type { RevenuePoint } from "@/types/game";

function series(values: number[]): RevenuePoint[] {
  return values.map((y, i) => ({ x: `Q${i + 1}`, y }));
}

describe("visibleQuarterCount", () => {
  it("steps by 2 from a base of 4 across the whole game", () => {
    const full = 12;
    expect(visibleQuarterCount(0, full)).toBe(4);
    expect(visibleQuarterCount(1, full)).toBe(6);
    expect(visibleQuarterCount(2, full)).toBe(8);
    expect(visibleQuarterCount(3, full)).toBe(10);
    expect(visibleQuarterCount(4, full)).toBe(12);
  });

  it("never exceeds the 12-quarter cap on the final guess", () => {
    expect(visibleQuarterCount(5, 12)).toBe(MAX_VISIBLE_QUARTERS);
    expect(visibleQuarterCount(99, 12)).toBe(MAX_VISIBLE_QUARTERS);
  });

  it("clamps to a legacy 28-entry payload's most recent 12", () => {
    expect(visibleQuarterCount(4, 28)).toBe(12);
  });

  it("never requests more than a short-history ticker actually has", () => {
    // MIN_USABLE_QUARTERS is 8, so 8-entry tickers are legitimate
    expect(visibleQuarterCount(0, 8)).toBe(4);
    expect(visibleQuarterCount(2, 8)).toBe(8);
    expect(visibleQuarterCount(5, 8)).toBe(8);
  });
});

describe("visibleSlice", () => {
  it("takes the most recent quarters, not the oldest", () => {
    const data = series([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(visibleSlice(data, 4).map((d) => d.y)).toEqual([5, 6, 7, 8]);
  });
});

describe("barColorsForVisible", () => {
  it("colors green when revenue rose vs the previous quarter, red when it fell", () => {
    const data = series([10, 20, 15, 25]);
    expect(barColorsForVisible(data, 4)).toEqual([UP_COLOR, UP_COLOR, DOWN_COLOR, UP_COLOR]);
  });

  it("keeps a quarter's color identical as more bars are revealed", () => {
    // y=15 falls vs the preceding 20, so it must read red at every reveal depth
    const data = series([10, 20, 15, 25, 30, 20]);
    const atG0 = barColorsForVisible(data, 4); // shows [15, 25, 30, 20]
    const atG4 = barColorsForVisible(data, 6); // shows all six
    expect(atG0[0]).toBe(DOWN_COLOR);
    expect(atG4[2]).toBe(DOWN_COLOR);
    expect(atG0[0]).toBe(atG4[2]);
  });

  it("defaults the very first bar of the full array to green", () => {
    const data = series([10, 5]);
    expect(barColorsForVisible(data, 2)[0]).toBe(UP_COLOR);
  });
});
