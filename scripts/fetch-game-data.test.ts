import { describe, it, expect } from "vitest";
import { toAlphaVantageSymbol, parseSeries, barLabel, assertNotThrottled } from "./fetch-game-data";

describe("fetch-game-data helpers", () => {
  it("converts dot share-class tickers to dash for Alpha Vantage", () => {
    expect(toAlphaVantageSymbol("BRK.B")).toBe("BRK-B");
    expect(toAlphaVantageSymbol("AAPL")).toBe("AAPL");
  });

  it("labels bars by interval", () => {
    expect(barLabel(0, "1d")).toBe("Day 1");
    expect(barLabel(2, "1w")).toBe("Wk 3");
    expect(barLabel(1, "1h")).toBe("Hr 2");
  });

  it("parses an Alpha Vantage time-series object into oldest-first OHLC, last 30", () => {
    const series = {
      "2026-06-26": { "1. open": "10", "2. high": "12", "3. low": "9", "4. close": "11" },
      "2026-06-25": { "1. open": "8", "2. high": "9", "3. low": "7", "4. close": "8.5" },
    };
    const bars = parseSeries(series, "1d", 30);
    expect(bars).toHaveLength(2);
    expect(bars[0].x).toBe("Day 1");
    expect(bars[0].y).toEqual([8, 9, 7, 8.5]); // oldest first
    expect(bars[1].y).toEqual([10, 12, 9, 11]);
  });

  it("throws on an Alpha Vantage rate-limit / error series", () => {
    expect(() => parseSeries({}, "1d", 30)).toThrow();
  });

  it("throws when Alpha Vantage signals throttling or an error", () => {
    expect(() => assertNotThrottled({ Note: "Thank you for using Alpha Vantage..." })).toThrow();
    expect(() => assertNotThrottled({ Information: "rate limit reached" })).toThrow();
    expect(() => assertNotThrottled({ "Error Message": "Invalid API call" })).toThrow();
    expect(() => assertNotThrottled({ "Time Series (Daily)": {} })).not.toThrow();
  });
});
