import { describe, it, expect } from "vitest";
import { parseSeries, barLabel, assertNotThrottled } from "./fetch-game-data";

describe("fetch-game-data helpers", () => {
  it("labels bars by interval", () => {
    expect(barLabel(0, "1d")).toBe("Day 1");
    expect(barLabel(2, "1w")).toBe("Wk 3");
    expect(barLabel(1, "1h")).toBe("Hr 2");
  });

  it("parses a Twelve Data time-series array into oldest-first OHLC, last 30", () => {
    const series = [
      { datetime: "2026-06-26", open: "10", high: "12", low: "9", close: "11" },
      { datetime: "2026-06-25", open: "8", high: "9", low: "7", close: "8.5" },
    ];
    const bars = parseSeries(series, "1d", 30);
    expect(bars).toHaveLength(2);
    expect(bars[0].x).toBe("Day 1");
    expect(bars[0].y).toEqual([8, 9, 7, 8.5]); // oldest first
    expect(bars[1].y).toEqual([10, 12, 9, 11]);
  });

  it("throws on an empty Twelve Data series", () => {
    expect(() => parseSeries([], "1d", 30)).toThrow();
  });

  it("throws when Twelve Data signals an error", () => {
    expect(() => assertNotThrottled({ status: "error", message: "Invalid API call" })).toThrow();
    expect(() => assertNotThrottled({ status: "ok", values: [] })).not.toThrow();
  });
});
