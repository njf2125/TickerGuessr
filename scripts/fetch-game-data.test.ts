import { describe, it, expect } from "vitest";
import { parseSeries, assertNotThrottled } from "./fetch-game-data";

describe("fetch-game-data helpers", () => {
  const series = [
    { datetime: "2026-06-26", open: "10", high: "12", low: "9", close: "11" },
    { datetime: "2026-06-25", open: "8", high: "9", low: "7", close: "8.5" },
  ];

  it("orders OHLC oldest-first, last N bars", () => {
    const bars = parseSeries(series, 30, "2026-07-07", "1d");
    expect(bars).toHaveLength(2);
    expect(bars[0].y).toEqual([8, 9, 7, 8.5]); // oldest first
    expect(bars[1].y).toEqual([10, 12, 9, 11]);
  });

  it("replaces real dates with a synthetic calendar, decoupled from the real trading dates", () => {
    const bars = parseSeries(series, 30, "2026-07-07", "1d");
    expect(bars[0].x).not.toBe("2026-06-25");
    expect(bars[1].x).not.toBe("2026-06-26");
    // deterministic per seed
    const again = parseSeries(series, 30, "2026-07-07", "1d");
    expect(again[0].x).toBe(bars[0].x);
    // daily bars are one day apart
    const day0 = new Date(bars[0].x).getTime();
    const day1 = new Date(bars[1].x).getTime();
    expect(day1 - day0).toBe(24 * 60 * 60 * 1000);
  });

  it("spaces weekly and monthly bars further apart", () => {
    const weekly = parseSeries(series, 30, "2026-07-07", "1w");
    const w0 = new Date(weekly[0].x).getTime();
    const w1 = new Date(weekly[1].x).getTime();
    expect(w1 - w0).toBe(7 * 24 * 60 * 60 * 1000);

    const monthly = parseSeries(series, 30, "2026-07-07", "1mo");
    const m0 = new Date(monthly[0].x).getTime();
    const m1 = new Date(monthly[1].x).getTime();
    expect(m1 - m0).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("throws on an empty Twelve Data series", () => {
    expect(() => parseSeries([], 30, "2026-07-07", "1d")).toThrow();
  });

  it("throws when Twelve Data signals an error", () => {
    expect(() => assertNotThrottled({ status: "error", message: "Invalid API call" })).toThrow();
    expect(() => assertNotThrottled({ status: "ok", values: [] })).not.toThrow();
  });
});
