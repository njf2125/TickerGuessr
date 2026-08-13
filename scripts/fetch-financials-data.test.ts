import os from "os";
import fs from "fs/promises";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  isSingleQuarterSpan,
  dedupeByPeriod,
  extractQuarterlySeries,
  trendDirection,
  fetchConceptWithFallback,
  lookupCik,
  assertNotSecThrottled,
  recentlyUsedTickers,
  pruneOldPublicFiles,
  fakeQuarterLabels,
  retentionKeepDates,
  MAX_REVENUE_QUARTERS,
  MAX_TREND_QUARTERS,
  Fetcher,
  SecFactUnit,
  TickerHistoryEntry,
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

  it("merges near-duplicate periods with slightly different boundary dates", () => {
    // Real shape found live in Coca-Cola's (KO) SEC data during code review:
    // the same real Q3 2010 quarter reported twice with start off by a day.
    const units: SecFactUnit[] = [
      { start: "2010-07-02", end: "2010-10-01", val: 8426000000, filed: "2011-10-27", form: "10-Q" },
      { start: "2010-07-03", end: "2010-10-01", val: 8426000000, filed: "2010-10-29", form: "10-Q" },
    ];
    const result = dedupeByPeriod(units);
    expect(result).toHaveLength(1);
    expect(result[0].filed).toBe("2011-10-27");
  });

  it("does not merge genuinely distinct quarters ~90 days apart", () => {
    const units: SecFactUnit[] = [
      makeUnit("2018-09-30", "2018-12-29", 100),
      makeUnit("2018-12-30", "2019-03-30", 110),
    ];
    const result = dedupeByPeriod(units);
    expect(result).toHaveLength(2);
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
    const result = extractQuarterlySeries(units, MAX_REVENUE_QUARTERS);
    expect(result).not.toBeNull();
    expect(result!.map((u) => u.val)).toEqual([100, 110, 120, 130, 140, 150, 160, 170]);
  });

  it("returns null when there are fewer than 8 usable quarters", () => {
    const units = [makeUnit("2018-09-30", "2018-12-29", 100)];
    expect(extractQuarterlySeries(units, MAX_REVENUE_QUARTERS)).toBeNull();
  });

  it("honors the cap argument so revenue and trend windows stay decoupled", () => {
    // 30 consecutive real quarters, ~90 days apart so none get deduped together
    const units: SecFactUnit[] = [];
    let start = new Date("2015-01-01");
    for (let i = 0; i < 30; i++) {
      const end = new Date(start);
      end.setDate(end.getDate() + 90);
      units.push({
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        val: 1000 + i,
        filed: end.toISOString().slice(0, 10),
        form: "10-Q",
      });
      start = end;
    }
    expect(extractQuarterlySeries(units, MAX_REVENUE_QUARTERS)).toHaveLength(12);
    expect(extractQuarterlySeries(units, MAX_TREND_QUARTERS)).toHaveLength(28);
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

function fakeUnits(vals: number[]): SecFactUnit[] {
  const out: SecFactUnit[] = [];
  let start = new Date("2018-01-01");
  for (const v of vals) {
    const end = new Date(start);
    end.setDate(end.getDate() + 90);
    out.push({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      val: v,
      filed: end.toISOString().slice(0, 10),
      form: "10-Q",
    });
    start = end;
  }
  return out;
}

describe("assertNotSecThrottled", () => {
  it("throws on 429", () => {
    expect(() => assertNotSecThrottled(429)).toThrow(/throttled/i);
  });

  it("throws on 403", () => {
    expect(() => assertNotSecThrottled(403)).toThrow(/throttled/i);
  });

  it("does not throw on 200", () => {
    expect(() => assertNotSecThrottled(200)).not.toThrow();
  });
});

describe("fetchConceptWithFallback", () => {
  it("falls back to the next tag when the first tag has no usable data", async () => {
    const calls: string[] = [];
    const fetcher: Fetcher = {
      async getJson(url: string) {
        calls.push(url);
        if (url.includes("RevenueFromContractWithCustomerExcludingAssessedTax")) {
          return { status: 200, body: { units: { USD: [] } } };
        }
        if (url.includes("/Revenues.json")) {
          return { status: 200, body: { units: { USD: fakeUnits([1, 2, 3, 4, 5, 6, 7, 8]) } } };
        }
        return { status: 404, body: null };
      },
    };
    const result = await fetchConceptWithFallback(fetcher, "0000320193", [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ], MAX_REVENUE_QUARTERS);
    expect(result).not.toBeNull();
    expect(result!.map((u) => u.val)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(calls).toHaveLength(2);
  });

  it("returns null when no tag has usable data", async () => {
    const fetcher: Fetcher = {
      async getJson() {
        return { status: 404, body: null };
      },
    };
    const result = await fetchConceptWithFallback(fetcher, "0000000000", ["Revenues"], MAX_REVENUE_QUARTERS);
    expect(result).toBeNull();
  });

  it("throws when SEC responds with a throttling status", async () => {
    const fetcher: Fetcher = {
      async getJson() {
        return { status: 429, body: null };
      },
    };
    await expect(
      fetchConceptWithFallback(fetcher, "0000320193", ["Revenues"], MAX_REVENUE_QUARTERS)
    ).rejects.toThrow(/throttled/i);
  });
});

describe("lookupCik", () => {
  it("finds a ticker's CIK and pads to 10 digits", () => {
    const map = { "0": { ticker: "AAPL", cik_str: 320193 } };
    expect(lookupCik("AAPL", map)).toBe("0000320193");
  });

  it("returns null for an unknown ticker", () => {
    expect(lookupCik("ZZZZ", {})).toBeNull();
  });

  it("finds a dotted share-class ticker via SEC's dash notation", () => {
    // App convention is dot notation (BRK.B); SEC's company_tickers.json uses
    // dashes (BRK-B) — this is the same ticker-notation gotcha documented in
    // CLAUDE.md's "Ticker notation" section for prior data providers.
    const map = { "0": { ticker: "BRK-B", cik_str: 1067983 } };
    expect(lookupCik("BRK.B", map)).toBe("0001067983");
  });
});

describe("recentlyUsedTickers", () => {
  it("includes tickers used within the 180-day window", () => {
    const history: TickerHistoryEntry[] = [{ date: "2026-06-01", ticker: "AAPL" }];
    const used = recentlyUsedTickers(history, "2026-07-01");
    expect(used.has("AAPL")).toBe(true);
  });

  it("excludes tickers used more than 180 days before the target date", () => {
    const history: TickerHistoryEntry[] = [{ date: "2025-01-01", ticker: "AAPL" }];
    const used = recentlyUsedTickers(history, "2026-07-01");
    expect(used.has("AAPL")).toBe(false);
  });
});

describe("fakeQuarterLabels", () => {
  it("generates sequential Q labels with no real date info", () => {
    expect(fakeQuarterLabels(4)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
});

describe("retentionKeepDates", () => {
  const noon = Date.UTC(2026, 7, 12, 12, 0, 0); // 2026-08-12T12:00:00Z

  it("keeps yesterday so users west of UTC don't 404 on their local date", () => {
    // The client requests its LOCAL date; west of UTC that can be a day behind
    // the UTC filenames, so yesterday must survive the prune.
    expect(retentionKeepDates("2026-08-13", noon).has("2026-08-11")).toBe(true);
  });

  it("keeps today, tomorrow, and the generated date", () => {
    const keep = retentionKeepDates("2026-08-13", noon);
    expect(keep.has("2026-08-12")).toBe(true);
    expect(keep.has("2026-08-13")).toBe(true);
  });

  it("does not keep anything older than yesterday", () => {
    const keep = retentionKeepDates("2026-08-13", noon);
    expect(keep.has("2026-08-10")).toBe(false);
    expect(keep.has("2026-08-09")).toBe(false);
  });

  it("retains a backfill date outside the rolling window", () => {
    expect(retentionKeepDates("2026-09-01", noon).has("2026-09-01")).toBe(true);
  });
});

describe("pruneOldPublicFiles", () => {
  it("deletes files for dates not in the keep set", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tickerguessr-test-"));
    await fs.writeFile(path.join(dir, "2026-07-01.json"), "{}");
    await fs.writeFile(path.join(dir, "2026-07-02.json"), "{}");
    await pruneOldPublicFiles(dir, new Set(["2026-07-02"]));
    const remaining = await fs.readdir(dir);
    expect(remaining).toEqual(["2026-07-02.json"]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
