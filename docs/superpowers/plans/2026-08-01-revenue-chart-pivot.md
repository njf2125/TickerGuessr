# Revenue-Chart Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TickerGuessr's daily stock-price candlestick chart (removed for Twelve Data licensing reasons) with a real, free, zero-risk quarterly revenue chart sourced from SEC EDGAR, plus a net-income-trend hint, while keeping the rest of the game (brand, pool, 6-guess mechanic, hint cadence) unchanged.

**Architecture:** A new build-time script (`scripts/fetch-financials-data.ts`) fetches quarterly revenue and net income for the day's selected ticker from SEC EDGAR's public XBRL API (no vendor, no API key, no redistribution restriction), writes the same `public/games/YYYY-MM-DD.json` static-file shape the frontend already expects, and appends to a private ticker-usage log for the existing 180-day repeat exclusion. The frontend chart switches from a candlestick type to a bar type over the new revenue series.

**Tech Stack:** Next.js 14 / React, ApexCharts (`react-apexcharts`), TypeScript, Vitest, `tsx` for scripts, SEC EDGAR public XBRL API (`data.sec.gov`, `www.sec.gov`).

## Global Constraints

- Brand name, answer pool (S&P 500 ∪ Nasdaq-100), and 6-guess/progressive-hint mechanic are unchanged — this is a data-source swap, not a redesign.
- Every SEC EDGAR request must send `User-Agent: TickerGuessrBot/1.0 (https://tickerguessr.app)` (Wikimedia/SEC-style fair-access convention, matching the pattern already used in `scripts/build-puzzle-pool.ts`).
- SEC EDGAR signals throttling via HTTP status codes (403/429), not a JSON error body.
- Revenue tag fallback order (try each until one yields usable data): `RevenueFromContractWithCustomerExcludingAssessedTax`, `Revenues`, `SalesRevenueNet`, `SalesRevenueGoodsNet`, `SalesRevenueServicesNet`, `InterestAndDividendIncomeOperating`.
- Net income tag: `NetIncomeLoss`.
- A "usable" series needs at least 8 single-quarter data points after filtering/dedup; keep at most the most recent 28 quarters.
- Single-quarter span = `end - start` between 80 and 100 days (excludes year-to-date/cumulative entries SEC also returns under the same tag).
- Dedup a repeated `(start, end)` period by keeping the value from the most-recently-`filed` entry.
- Net income hint reveals at guess count ≥ 2 (alongside market cap tier); trend direction uses a linear regression slope over the series, not a first-half-vs-second-half average.
- `data/ticker-history.json` (outside `public/`) is the source of truth for the 180-day repeat-ticker exclusion — never `public/games/*.json`.
- `public/games/` retention: only today's and (if pre-generated) tomorrow's puzzle files; everything else gets pruned after each run.
- Full context: `docs/superpowers/specs/2026-07-31-revenue-chart-pivot-design.md` (read this if anything below is ambiguous).

---

### Task 1: Replace price-chart types with revenue-chart types, update chart component and its direct consumers

**Files:**
- Modify: `src/types/game.ts`
- Modify: `src/data/puzzle-selection.ts`
- Modify: `src/data/puzzle-selection.test.ts`
- Modify: `src/components/StockChart.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/HowToModal.tsx`

**Interfaces:**
- Produces: `RevenuePoint { x: string; y: number }`, `GameDayPayload` (now with `revenueData: RevenuePoint[]` and `netIncomeTrend: 'up' | 'down'`, no `interval`/`candlestickData`), `SelectedPuzzle` (no `interval` field). Later tasks (2, 3, 4, 5) construct/consume these exact shapes.

This task must land as one unit — TypeScript won't compile with the type changed but its two consumers (`StockChart.tsx`, `page.tsx`) still using the old shape.

- [ ] **Step 1: Update the shared type definitions**

Replace the full contents of `src/types/game.ts`:

```ts
export interface Company {
  ticker: string;
  name: string;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export interface RevenuePoint {
  x: string; // fake sequential period label, e.g. "Q1" — carries no real filing-quarter info
  y: number; // real quarterly revenue in USD; hidden from the player until solved/hover
}

export interface GameDayAnswer {
  ticker: string;
  companyName: string;
}

export interface GameDayPayload {
  gameId: number;
  dateString: string; // YYYY-MM-DD
  firstLetter: string;
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
  revenueData: RevenuePoint[];
  netIncomeTrend: 'up' | 'down';
}

export interface GuessResult {
  ticker: string;
  name: string;
  isCorrect: boolean;
  isSkip?: boolean;
}

export interface PlayerStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: [number, number, number, number, number, number];
}

export interface PersistedGameState {
  dateString: string;
  guesses: GuessResult[];
  status: GameStatus;
}
```

- [ ] **Step 2: Remove `interval` from puzzle selection**

Replace the full contents of `src/data/puzzle-selection.ts`:

```ts
import { PUZZLE_POOL } from "./puzzle-pool";
import { COMPANIES } from "./companies";
import { FAMILIAR_TICKERS } from "./familiar-tickers";

export const GAME_START_DATE = "2026-06-25";

export interface SelectedPuzzle {
  ticker: string;
  name: string;
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
}

// Only pool entries that are actually typeable in the autocomplete are eligible.
// Hoist the company-ticker Set so it is built once, not per filter iteration.
const COMPANY_TICKERS = new Set(COMPANIES.map((c) => c.ticker));
const ELIGIBLE = PUZZLE_POOL.filter((e) => COMPANY_TICKERS.has(e.ticker));

// Prefer recognizable household names so players have a real shot at guessing;
// falls back to the full eligible pool if the familiar subset is ever empty.
const FAMILIAR_ELIGIBLE = ELIGIBLE.filter((e) => FAMILIAR_TICKERS.has(e.ticker));

// Deterministic string -> 32-bit seed (xmur3) and PRNG (mulberry32).
export function seedFrom(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayOffset(dateString: string): number {
  const start = new Date(GAME_START_DATE).getTime();
  const target = new Date(dateString).getTime();
  return Math.round((target - start) / (1000 * 60 * 60 * 24));
}

export function gameIdFor(dateString: string): number {
  return dayOffset(dateString) + 1;
}

export function selectPuzzle(dateString: string, recentlyUsed: Set<string>): SelectedPuzzle {
  const rng = mulberry32(seedFrom(dateString));
  let candidates = FAMILIAR_ELIGIBLE.filter((e) => !recentlyUsed.has(e.ticker));
  // Safety nets, in priority order: prefer a fresh (not-recently-used) pick
  // over a familiar one, since the 180-day no-repeat rule is the harder
  // guarantee — only reuse a ticker if the wider pool is also exhausted.
  if (candidates.length === 0) candidates = ELIGIBLE.filter((e) => !recentlyUsed.has(e.ticker));
  if (candidates.length === 0) candidates = FAMILIAR_ELIGIBLE;
  if (candidates.length === 0) candidates = ELIGIBLE;
  if (candidates.length === 0) {
    throw new Error("No eligible puzzle tickers — pool ∩ companies is empty.");
  }
  const entry = candidates[Math.floor(rng() * candidates.length)];
  return {
    ticker: entry.ticker,
    name: entry.name,
    sector: entry.sector,
    marketCapTier: entry.marketCapTier,
    triviaHints: entry.triviaHints,
  };
}
```

- [ ] **Step 3: Remove the obsolete interval test**

In `src/data/puzzle-selection.test.ts`, delete this block (and nothing else):

```ts
  it("returns a valid interval", () => {
    const p = selectPuzzle("2026-07-09", new Set());
    expect(["1d", "1w", "1mo"]).toContain(p.interval);
  });

```

- [ ] **Step 4: Run the data-layer tests**

Run: `npx vitest run src/data/puzzle-selection.test.ts`
Expected: PASS (4 tests, down from 5)

- [ ] **Step 5: Rewrite the chart component for a revenue bar chart**

Replace the full contents of `src/components/StockChart.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { RevenuePoint } from "@/types/game";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface StockChartProps {
  data: RevenuePoint[];
  guessCount: number;
}

export function StockChart({ data, guessCount }: StockChartProps) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "bar",
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: false },
      },
      theme: { mode: "dark" },
      grid: {
        show: true,
        borderColor: "#374151",
      },
      xaxis: {
        categories: data.map((d) => d.x),
        labels: {
          show: true,
          style: { colors: "#9ca3af", fontSize: "10px" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { show: false },
      },
      // Bar/column charts default dataLabels to visible, which would print the
      // real revenue value on every bar regardless of guess count — must be
      // explicitly disabled to preserve the same anonymization the old
      // candlestick chart relied on (hidden axis values until solved/hover).
      dataLabels: { enabled: false },
      legend: { show: false },
      tooltip: {
        // Exact revenue on hover is more revealing than the shape alone.
        enabled: guessCount >= 3,
        theme: "dark",
        y: {
          formatter: (val: number) => `$${(val / 1_000_000).toFixed(0)}M`,
        },
      },
      plotOptions: {
        bar: {
          // distributed: true is required for the per-bar `colors` array
          // below to apply — without it every bar uses colors[0] only.
          distributed: true,
          columnWidth: "70%",
        },
      },
      colors: data.map((d, i) => (i === 0 || d.y >= data[i - 1].y ? "#22c55e" : "#ef4444")),
    }),
    [guessCount, data]
  );

  const series = useMemo(() => [{ name: "Revenue", data: data.map((d) => d.y) }], [data]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-gray-900">
      <span className="absolute top-2 right-2 z-10 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
        Quarterly Revenue
      </span>
      <ApexChart type="bar" series={series} options={options} height={260} width="100%" />
    </div>
  );
}
```

- [ ] **Step 6: Update `page.tsx` to pass the new prop shape**

In `src/app/page.tsx`, find:

```tsx
        <StockChart
          data={payload.candlestickData}
          interval={payload.interval}
          guessCount={guesses.length}
        />
```

Replace with:

```tsx
        <StockChart
          data={payload.revenueData}
          guessCount={guesses.length}
        />
```

- [ ] **Step 7: Update the chart description in How to Play**

In `src/components/HowToModal.tsx`, find:

```tsx
        <p className="text-sm text-gray-300">
          Guess the mystery stock from its candlestick chart in <strong>6 tries</strong>.
        </p>
        <ul className="flex flex-col gap-2 text-sm text-gray-300">
          <li>📈 The chart shows price and dates, but not the company.</li>
```

Replace with:

```tsx
        <p className="text-sm text-gray-300">
          Guess the mystery stock from its real quarterly revenue chart in <strong>6 tries</strong>.
        </p>
        <ul className="flex flex-col gap-2 text-sm text-gray-300">
          <li>📈 The chart shows real revenue history, but not the company or exact numbers.</li>
```

(Leave the hint-list `<li>` below this one alone — Task 5 updates it.)

- [ ] **Step 8: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all three pass (tsc: no errors; lint: no warnings; test: same test count as Step 4 plus any other unaffected suites)

- [ ] **Step 9: Commit**

```bash
git add src/types/game.ts src/data/puzzle-selection.ts src/data/puzzle-selection.test.ts src/components/StockChart.tsx src/app/page.tsx src/components/HowToModal.tsx
git commit -m "Replace price-chart types with revenue-chart types and bar chart"
```

---

### Task 2: Pure SEC data-shaping helpers (single-quarter filter, dedup, trend direction)

**Files:**
- Create: `scripts/fetch-financials-data.ts`
- Create: `scripts/fetch-financials-data.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks yet (pure functions, no I/O).
- Produces: `SecFactUnit { start: string; end: string; val: number; filed: string; form: string }`, `isSingleQuarterSpan(start, end): boolean`, `dedupeByPeriod(units): SecFactUnit[]`, `extractQuarterlySeries(units): SecFactUnit[] | null`, `trendDirection(values: number[]): 'up' | 'down'`. Task 3 imports and calls `extractQuarterlySeries`; Task 4 imports and calls `trendDirection`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/fetch-financials-data.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: FAIL — `scripts/fetch-financials-data.ts` does not exist yet

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/fetch-financials-data.ts`:

```ts
export interface SecFactUnit {
  start: string;
  end: string;
  val: number;
  filed: string;
  form: string;
}

const MIN_QUARTER_DAYS = 80;
const MAX_QUARTER_DAYS = 100;
const MIN_USABLE_QUARTERS = 8;
const MAX_QUARTERS_KEPT = 28;

export function isSingleQuarterSpan(start: string, end: string): boolean {
  const days = (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24);
  return days >= MIN_QUARTER_DAYS && days <= MAX_QUARTER_DAYS;
}

export function dedupeByPeriod(units: SecFactUnit[]): SecFactUnit[] {
  const byPeriod = new Map<string, SecFactUnit>();
  for (const u of units) {
    const key = `${u.start}_${u.end}`;
    const existing = byPeriod.get(key);
    if (!existing || new Date(u.filed).getTime() > new Date(existing.filed).getTime()) {
      byPeriod.set(key, u);
    }
  }
  return Array.from(byPeriod.values());
}

// SEC's companyconcept API returns every historical filing's reported value for
// a tag, mixing true single-quarter figures with cumulative year-to-date figures
// reported in later quarters' 10-Qs, all under the same tag/form. Verified live
// against AAPL's data during design: 80 raw form:"10-Q" entries collapsed to 45
// unique (start,end) periods — roughly half the raw entries were YTD spans.
export function extractQuarterlySeries(units: SecFactUnit[]): SecFactUnit[] | null {
  const quarterly = units.filter(
    (u) => (u.form === "10-Q" || u.form === "10-K") && isSingleQuarterSpan(u.start, u.end)
  );
  const deduped = dedupeByPeriod(quarterly).sort((a, b) => a.end.localeCompare(b.end));
  if (deduped.length < MIN_USABLE_QUARTERS) return null;
  return deduped.slice(-MAX_QUARTERS_KEPT);
}

// Sign of the linear regression slope over a value series (index as x). More
// robust to a handful of lumpy one-off quarters than a first-half vs.
// second-half average — see docs/superpowers/specs/2026-07-31-revenue-chart-pivot-design.md.
export function trendDirection(values: number[]): "up" | "down" {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  const slope = den === 0 ? 0 : num / den;
  return slope >= 0 ? "up" : "down";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-financials-data.ts scripts/fetch-financials-data.test.ts
git commit -m "Add pure SEC data-shaping helpers: single-quarter filter, dedup, trend direction"
```

---

### Task 3: SEC fetch-with-fallback and CIK lookup (network layer, dependency-injected for testing)

**Files:**
- Modify: `scripts/fetch-financials-data.ts`
- Modify: `scripts/fetch-financials-data.test.ts`

**Interfaces:**
- Consumes: `SecFactUnit`, `extractQuarterlySeries` (Task 2, same file).
- Produces: `Fetcher` interface, `httpsFetcher(): Fetcher`, `assertNotSecThrottled(status: number): void`, `REVENUE_TAGS: string[]`, `NET_INCOME_TAGS: string[]`, `fetchConceptWithFallback(fetcher: Fetcher, cik: string, tags: string[]): Promise<SecFactUnit[] | null>`, `lookupCik(ticker: string, tickerMap: Record<string, {ticker: string; cik_str: number}>): string | null`. Task 4 imports and calls all of these.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/fetch-financials-data.test.ts` (add the import names to the existing import statement, then add these `describe` blocks):

```ts
import {
  isSingleQuarterSpan,
  dedupeByPeriod,
  extractQuarterlySeries,
  trendDirection,
  fetchConceptWithFallback,
  lookupCik,
  assertNotSecThrottled,
  Fetcher,
  SecFactUnit,
} from "./fetch-financials-data";
```

```ts
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
    ]);
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
    const result = await fetchConceptWithFallback(fetcher, "0000000000", ["Revenues"]);
    expect(result).toBeNull();
  });

  it("throws when SEC responds with a throttling status", async () => {
    const fetcher: Fetcher = {
      async getJson() {
        return { status: 429, body: null };
      },
    };
    await expect(
      fetchConceptWithFallback(fetcher, "0000320193", ["Revenues"])
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: FAIL — `fetchConceptWithFallback`, `lookupCik`, `assertNotSecThrottled`, `Fetcher` are not exported yet

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/fetch-financials-data.ts` (add `import https from "https";` at the top of the file):

```ts
export interface Fetcher {
  getJson(url: string): Promise<{ status: number; body: unknown }>;
}

const SEC_USER_AGENT = "TickerGuessrBot/1.0 (https://tickerguessr.app)";

export function httpsFetcher(): Fetcher {
  return {
    getJson(url: string) {
      return new Promise((resolve, reject) => {
        const req = https.get(
          url,
          { headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" } },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              const status = res.statusCode ?? 0;
              if (status !== 200) return resolve({ status, body: null });
              try {
                resolve({ status, body: JSON.parse(data) });
              } catch (e) {
                reject(e);
              }
            });
          }
        );
        req.on("error", reject);
        req.setTimeout(15_000, () => req.destroy(new Error(`timed out: ${url}`)));
      });
    },
  };
}

export function assertNotSecThrottled(status: number): void {
  if (status === 403 || status === 429) {
    throw new Error(`SEC EDGAR throttled or blocked request (HTTP ${status})`);
  }
}

export const REVENUE_TAGS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
  "SalesRevenueGoodsNet",
  "SalesRevenueServicesNet",
  "InterestAndDividendIncomeOperating",
];
export const NET_INCOME_TAGS = ["NetIncomeLoss"];

export async function fetchConceptWithFallback(
  fetcher: Fetcher,
  cik: string,
  tags: string[]
): Promise<SecFactUnit[] | null> {
  for (const tag of tags) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
    const { status, body } = await fetcher.getJson(url);
    assertNotSecThrottled(status);
    if (status !== 200 || !body) continue;
    const units = (body as { units?: { USD?: SecFactUnit[] } }).units?.USD;
    if (!Array.isArray(units)) continue;
    const series = extractQuarterlySeries(units);
    if (series) return series;
  }
  return null;
}

export function lookupCik(
  ticker: string,
  tickerMap: Record<string, { ticker: string; cik_str: number }>
): string | null {
  const entry = Object.values(tickerMap).find(
    (v) => v.ticker === ticker || v.ticker === ticker.replace(".", "-")
  );
  return entry ? String(entry.cik_str).padStart(10, "0") : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: PASS (15 tests total: 7 from Task 2 + 8 new)

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-financials-data.ts scripts/fetch-financials-data.test.ts
git commit -m "Add SEC fetch-with-fallback and CIK lookup (dependency-injected fetcher)"
```

---

### Task 4: Puzzle generation orchestration — retry/reselect, ticker history, pruning, CLI entrypoint

**Files:**
- Modify: `scripts/fetch-financials-data.ts`
- Modify: `scripts/fetch-financials-data.test.ts`

**Interfaces:**
- Consumes: `SelectedPuzzle`, `selectPuzzle`, `gameIdFor` (from `../src/data/puzzle-selection`); `GameDayPayload`, `GameDayAnswer`, `RevenuePoint` (from `../src/types/game`); `Fetcher`, `httpsFetcher`, `assertNotSecThrottled`, `REVENUE_TAGS`, `NET_INCOME_TAGS`, `fetchConceptWithFallback`, `lookupCik`, `trendDirection` (Tasks 2–3, same file).
- Produces: `TickerHistoryEntry { date: string; ticker: string }`, `recentlyUsedTickers(history, targetDate): Set<string>`, `pruneOldPublicFiles(gamesDir, keepDates): Promise<void>`, `fakeQuarterLabels(count): string[]`, `main()` (CLI entrypoint, not exported/tested directly — matches how the old `fetch-game-data.ts`'s `main()` wasn't unit tested either).

- [ ] **Step 1: Write the failing tests for the pure/file-system-only pieces**

Add `import os from "os";` and `import fs from "fs/promises";` and `import path from "path";` to the top of `scripts/fetch-financials-data.test.ts`, add `recentlyUsedTickers`, `pruneOldPublicFiles`, `fakeQuarterLabels`, `TickerHistoryEntry` to the import from `"./fetch-financials-data"`, then append:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: FAIL — `recentlyUsedTickers`, `pruneOldPublicFiles`, `fakeQuarterLabels`, `TickerHistoryEntry` are not exported yet

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/fetch-financials-data.ts` (add `import fs from "fs/promises";` and `import path from "path";` at the top, alongside the existing `import https from "https";`, and add `import { selectPuzzle, SelectedPuzzle, gameIdFor } from "../src/data/puzzle-selection";` and `import type { GameDayPayload, GameDayAnswer, RevenuePoint } from "../src/types/game";`):

```ts
const MAX_TICKER_RETRIES = 15;
const HISTORY_WINDOW_DAYS = 180;
const TICKER_HISTORY_PATH = path.join(process.cwd(), "data", "ticker-history.json");

export interface TickerHistoryEntry {
  date: string;
  ticker: string;
}

async function readTickerHistory(): Promise<TickerHistoryEntry[]> {
  try {
    const raw = await fs.readFile(TICKER_HISTORY_PATH, "utf8");
    return JSON.parse(raw) as TickerHistoryEntry[];
  } catch {
    return [];
  }
}

async function appendTickerHistory(entry: TickerHistoryEntry): Promise<void> {
  const history = await readTickerHistory();
  history.push(entry);
  await fs.writeFile(TICKER_HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
}

export function recentlyUsedTickers(history: TickerHistoryEntry[], targetDate: string): Set<string> {
  const target = new Date(targetDate).getTime();
  const windowMs = HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const used = new Set<string>();
  for (const h of history) {
    const d = new Date(h.date).getTime();
    if (!isNaN(d) && d < target && target - d <= windowMs) used.add(h.ticker);
  }
  return used;
}

export async function pruneOldPublicFiles(gamesDir: string, keepDates: Set<string>): Promise<void> {
  let files: string[] = [];
  try {
    files = await fs.readdir(gamesDir);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const date = f.replace("-answer.json", "").replace(".json", "");
    if (!keepDates.has(date)) {
      await fs.unlink(path.join(gamesDir, f));
    }
  }
}

export function fakeQuarterLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Q${i + 1}`);
}

async function pickPuzzleWithData(
  fetcher: Fetcher,
  tickerMap: Record<string, { ticker: string; cik_str: number }>,
  dateString: string,
  history: TickerHistoryEntry[]
): Promise<{ puzzle: SelectedPuzzle; revenue: SecFactUnit[]; netIncome: SecFactUnit[] | null }> {
  const excluded = recentlyUsedTickers(history, dateString);
  for (let attempt = 0; attempt < MAX_TICKER_RETRIES; attempt++) {
    const puzzle = selectPuzzle(dateString, excluded);
    const cik = lookupCik(puzzle.ticker, tickerMap);
    if (cik) {
      const revenue = await fetchConceptWithFallback(fetcher, cik, REVENUE_TAGS);
      if (revenue) {
        const netIncome = await fetchConceptWithFallback(fetcher, cik, NET_INCOME_TAGS);
        return { puzzle, revenue, netIncome };
      }
    }
    excluded.add(puzzle.ticker);
  }
  throw new Error(
    `No ticker with usable SEC revenue data found after ${MAX_TICKER_RETRIES} attempts for ${dateString}`
  );
}

async function generateGameFile(dateString: string): Promise<void> {
  const fetcher = httpsFetcher();
  const gamesDir = path.join(process.cwd(), "public", "games");
  const history = await readTickerHistory();

  const { status, body } = await fetcher.getJson("https://www.sec.gov/files/company_tickers.json");
  assertNotSecThrottled(status);
  if (status !== 200 || !body) throw new Error("Failed to fetch SEC company_tickers.json");
  const tickerMap = body as Record<string, { ticker: string; cik_str: number }>;

  const { puzzle, revenue, netIncome } = await pickPuzzleWithData(fetcher, tickerMap, dateString, history);
  console.log(`Generating ${dateString}: ${puzzle.ticker}`);

  const labels = fakeQuarterLabels(revenue.length);
  const revenueData: RevenuePoint[] = revenue.map((u, i) => ({ x: labels[i], y: u.val }));
  const netIncomeTrend: "up" | "down" = netIncome ? trendDirection(netIncome.map((u) => u.val)) : "up";

  const payload: GameDayPayload = {
    gameId: gameIdFor(dateString),
    dateString,
    firstLetter: puzzle.ticker[0],
    sector: puzzle.sector,
    marketCapTier: puzzle.marketCapTier,
    triviaHints: puzzle.triviaHints,
    revenueData,
    netIncomeTrend,
  };
  const answer: GameDayAnswer = { ticker: puzzle.ticker, companyName: puzzle.name };

  await fs.mkdir(gamesDir, { recursive: true });
  await fs.writeFile(path.join(gamesDir, `${dateString}.json`), JSON.stringify(payload, null, 2) + "\n");
  await fs.writeFile(path.join(gamesDir, `${dateString}-answer.json`), JSON.stringify(answer, null, 2) + "\n");
  await appendTickerHistory({ date: dateString, ticker: puzzle.ticker });

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await pruneOldPublicFiles(gamesDir, new Set([today, tomorrow, dateString]));

  console.log(`Wrote ${dateString}.json + -answer.json`);
}

// Usage: npx tsx scripts/fetch-financials-data.ts [YYYY-MM-DD]  (defaults to tomorrow, UTC)
async function main() {
  const arg = process.argv[2];
  let date: string;
  if (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      console.error("Usage: npx tsx scripts/fetch-financials-data.ts [YYYY-MM-DD]");
      process.exit(1);
    }
    date = arg;
  } else {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    date = t.toISOString().split("T")[0];
  }
  await generateGameFile(date);
}

if (process.argv[1] && path.basename(process.argv[1]) === "fetch-financials-data.ts") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: PASS (19 tests total: 15 from Tasks 2–3 + 4 new)

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-financials-data.ts scripts/fetch-financials-data.test.ts
git commit -m "Wire up puzzle generation: retry/reselect, ticker history, pruning, CLI entrypoint"
```

---

### Task 5: Net income hint chip

**Files:**
- Modify: `src/components/HintContainer.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/HowToModal.tsx`

**Interfaces:**
- Consumes: `payload.netIncomeTrend` (Task 1's `GameDayPayload`).

- [ ] **Step 1: Add the `netIncomeTrend` prop and hint chip**

Replace the full contents of `src/components/HintContainer.tsx`:

```tsx
interface HintContainerProps {
  sector: string;
  marketCapTier: string;
  netIncomeTrend: "up" | "down";
  triviaHints: [string, string];
  firstLetter: string;
  guessCount: number;
}

// A hint still carrying the generated `TODO:` placeholder is never rendered —
// guards against a forgotten day shipping placeholder text to players.
function isReal(hint: string | undefined): hint is string {
  return !!hint && !hint.startsWith("TODO:");
}

// Reveal curve is staggered so every wrong guess (through 5) unlocks something:
// g1 sector, g2 market cap + net income trend, g3 trivia[0], g4 trivia[1], g5 starting letter.
// (g3 also flips on the chart's hover tooltip, in StockChart — a bonus, not
// the guess's real hint, since it's invisible/unreliable on touch devices.)
export function HintContainer({
  sector,
  marketCapTier,
  netIncomeTrend,
  triviaHints,
  firstLetter,
  guessCount,
}: HintContainerProps) {
  if (guessCount < 1) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <span className="text-xs px-3 py-1 rounded-full bg-blue-900/50 text-blue-300 border border-blue-800">
          📊 {sector}
        </span>
        {guessCount >= 2 && (
          <span className="text-xs px-3 py-1 rounded-full bg-purple-900/50 text-purple-300 border border-purple-800">
            💰 {marketCapTier}
          </span>
        )}
        {guessCount >= 2 && (
          <span className="text-xs px-3 py-1 rounded-full bg-teal-900/50 text-teal-300 border border-teal-800">
            {netIncomeTrend === "up" ? "📈 Net income trending up" : "📉 Net income trending down"}
          </span>
        )}
        {guessCount >= 5 && (
          <span className="text-xs px-3 py-1 rounded-full bg-amber-900/50 text-amber-300 border border-amber-800">
            🔤 Starts with {firstLetter}
          </span>
        )}
      </div>
      {guessCount >= 3 && isReal(triviaHints[0]) && (
        <p className="text-xs text-gray-300 bg-gray-800/60 rounded-lg px-3 py-2 leading-relaxed">
          💡 {triviaHints[0]}
        </p>
      )}
      {guessCount >= 4 && isReal(triviaHints[1]) && (
        <p className="text-xs text-gray-300 bg-gray-800/60 rounded-lg px-3 py-2 leading-relaxed">
          💡 {triviaHints[1]}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Pass the new prop from `page.tsx`**

In `src/app/page.tsx`, find the `<HintContainer ... />` block and add `netIncomeTrend={payload.netIncomeTrend}` as a new prop line (alongside the existing `sector`, `marketCapTier`, etc. props).

- [ ] **Step 3: Update the hint-list copy in How to Play**

In `src/components/HowToModal.tsx`, find:

```tsx
          <li>💡 Each wrong guess unlocks a new hint — sector, then market cap, then two trivia clues, then the starting letter.</li>
```

Replace with:

```tsx
          <li>💡 Each wrong guess unlocks a new hint — sector, then market cap and net income trend, then two trivia clues, then the starting letter.</li>
```

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/components/HintContainer.tsx src/app/page.tsx src/components/HowToModal.tsx
git commit -m "Add net income trend hint at guess 2"
```

---

### Task 6: Daily GitHub Actions workflow

**Files:**
- Create: `.github/workflows/daily-financials.yml`

**Interfaces:**
- Consumes: `scripts/fetch-financials-data.ts` (Task 4) as the script it runs.

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/daily-financials.yml`:

```yaml
name: Daily Financials Generator

on:
  schedule:
    - cron: '0 6 * * *'  # 6:00 UTC daily
  workflow_dispatch:
    inputs:
      date:
        description: 'Target date (YYYY-MM-DD). Defaults to tomorrow.'
        required: false

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GH_PAT }}

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci

      - name: Generate game file
        # Pass the dispatch input via env (never interpolated into the shell line)
        # to avoid GitHub Actions script injection. Empty -> script defaults to tomorrow.
        # No API key needed — SEC EDGAR is keyless, unlike the old Twelve Data pipeline.
        env:
          TARGET_DATE: ${{ github.event.inputs.date || '' }}
        run: npx tsx scripts/fetch-financials-data.ts "$TARGET_DATE"

      # main is protected (required "check" status + no direct pushes), so the bot
      # commits to its own branch and opens a PR instead of pushing to main directly.
      - name: Commit game file to automation branch
        id: commit
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: generate daily game'
          file_pattern: 'public/games/*.json data/ticker-history.json'
          branch: automation/daily-financials-${{ github.run_id }}
          create_branch: true

      - name: Open PR and enable auto-merge
        if: steps.commit.outputs.changes_detected == 'true'
        env:
          GH_TOKEN: ${{ secrets.GH_PAT }}
        run: |
          gh pr create \
            --title "chore: generate daily game" \
            --body "Automated daily puzzle generation." \
            --base main \
            --head "automation/daily-financials-${{ github.run_id }}"
          gh pr merge --auto --squash "automation/daily-financials-${{ github.run_id }}"
```

- [ ] **Step 2: Validate the YAML**

Run: `npx tsx -e "require('js-yaml') ? null : null"` — skip this if `js-yaml` isn't a dependency; instead just visually confirm indentation matches `.github/workflows/pool-refresh.yml`'s style, and rely on GitHub's own validation when the workflow first runs (`workflow_dispatch` can be triggered manually via `gh workflow run` to confirm it parses, once merged).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-financials.yml
git commit -m "Re-add daily generation workflow for the SEC-based pipeline"
```

---

### Task 7: Update CLAUDE.md and AGENTS.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md` (kept identical to `CLAUDE.md` except the first two lines — see existing pattern in git history: both files are synced via a small script that swaps the header, e.g. `python3 -c "..."` replacing `"# CLAUDE.md\n\nThis file provides guidance to Claude Code (claude.ai/code)"` with `"# AGENTS.md\n\nThis file provides guidance to Codex (Codex.ai/code)"`)

- [ ] **Step 1: Update `CLAUDE.md`**

Replace the "Commands" block's autocomplete/pool lines section is unaffected; add back a fixture-generation command line after the `build-puzzle-pool.ts` line:

```bash
# Generate a game fixture (no API key needed — SEC EDGAR is keyless)
npx tsx scripts/fetch-financials-data.ts 2026-08-05
```

Replace the "Data pipeline" section (currently describing the paused state) with:

```markdown
### Data pipeline (automated, no runtime API calls)

```
GitHub Actions cron (6:00 UTC daily)
  → scripts/fetch-financials-data.ts
      → reads data/ticker-history.json for the 180-day exclusion set
      → calls selectPuzzle(date, recentlyUsed) — deterministic, date-seeded
      → looks up the ticker's CIK via SEC's company_tickers.json
      → fetches quarterly revenue + net income from SEC EDGAR's XBRL API
      → writes public/games/YYYY-MM-DD.json + -answer.json
      → appends {date, ticker} to data/ticker-history.json
      → prunes public/games/ down to just today + tomorrow
      → auto-committed → triggers Vercel deploy
```

Players fetch `/games/${date}.json` statically — zero live financial API calls at runtime.

SEC EDGAR is free, public-domain, government-sourced data with no vendor and no
redistribution restriction — this replaced Twelve Data (removed for exactly that
restriction) and, before it, an evaluation of Polygon.io, yfinance/Yahoo Finance,
Alpha Vantage, Tiingo, and Stooq, all of which restrict free-tier redistribution
for the same structural reason. See
`docs/superpowers/specs/2026-07-31-revenue-chart-pivot-design.md` for the full
comparison.
```

Replace the "Puzzle selection" section's `interval`/`CandleInterval` bullet with:

```markdown
- 180-day exclusion window: `recentlyUsedTickers()` in `fetch-financials-data.ts` reads `data/ticker-history.json` (not `public/games/`) to build the exclusion set before calling `selectPuzzle`.
- `gameIdFor(dateString)` → day offset from `GAME_START_DATE = "2026-06-25"` + 1.
```

(Remove the `CandleInterval` bullet entirely — that type no longer exists.)

Replace the "Ticker notation" section's Twelve-Data-specific bullet — just keep:

```markdown
### Ticker notation

- **App / payload**: dot notation for share classes (`BRK.B`, `BF.B`)
- `normalizeTicker()` in the build scripts normalizes source dashes/slashes to dots.
```

Add a new section after "Market cap tiers" (keep that section as-is, it's unrelated):

```markdown
### SEC EDGAR data source

`scripts/fetch-financials-data.ts` fetches quarterly revenue and net income from
SEC EDGAR's XBRL company-concept API (`data.sec.gov`), using a fallback tag list
for revenue (companies use different tags across years/industries — see the tag
list in the script) and `NetIncomeLoss` for net income. Every request sends a
descriptive `User-Agent` per SEC's fair-access policy. Throttling is signaled via
HTTP 403/429, not a JSON error body.

A ticker with no usable SEC data (recent IPO with too few filings, or a foreign
private issuer filing annual 20-F instead of quarterly 10-Q) triggers a
retry-and-reselect loop rather than failing the whole run — see
`pickPuzzleWithData` in the script.

Revenue and net income values from SEC's API mix true single-quarter figures
with cumulative year-to-date figures under the same tag — `extractQuarterlySeries`
filters to true single-quarter spans (80–100 day range) and deduplicates
restated periods before use. This was a real bug caught during design review, not
a hypothetical — see the spec doc for the live-data verification.
```

Replace the "CI" section:

```markdown
### CI

`.github/workflows/daily-financials.yml`:
- `generate` job: runs daily at 6:00 UTC, calls `fetch-financials-data.ts`, auto-commits the new JSON + ticker history.

`.github/workflows/pool-refresh.yml`:
- `refresh-pool` job: runs monthly (1st of the month, 6:00 UTC), re-runs both build scripts and runs the winnable-pool test before committing.
```

Remove the "Resuming daily generation" section entirely (generation is resumed now, not paused).

- [ ] **Step 2: Sync `AGENTS.md`**

Run:

```bash
python3 - <<'PYEOF'
with open('CLAUDE.md') as f:
    claude = f.read()
new_agents = claude.replace(
    "# CLAUDE.md\n\nThis file provides guidance to Claude Code (claude.ai/code)",
    "# AGENTS.md\n\nThis file provides guidance to Codex (Codex.ai/code)"
)
with open('AGENTS.md', 'w') as f:
    f.write(new_agents)
PYEOF
diff AGENTS.md CLAUDE.md
```

Expected: the only diff is the header/first-paragraph lines (same pattern as every prior doc update this project).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "Update CLAUDE.md/AGENTS.md for the SEC-based data pipeline"
```

---

### Task 8: Regenerate live fixtures and verify end-to-end

**Files:**
- Delete: `public/games/2026-07-31.json`, `public/games/2026-07-31-answer.json`, `public/games/2026-08-01.json`, `public/games/2026-08-01-answer.json` (old price-schema fixtures, incompatible with the new schema)
- Create (generated by script, not hand-written): new `public/games/*.json` files for the current day and the day after

- [ ] **Step 1: Delete the old-schema fixtures**

```bash
git rm public/games/2026-07-31.json public/games/2026-07-31-answer.json public/games/2026-08-01.json public/games/2026-08-01-answer.json
```

(If today's actual date has moved past these by the time this task runs, `ls public/games/` first and delete whatever's there instead — the goal is an empty `public/games/` before regenerating, since every existing file is under the old schema.)

- [ ] **Step 2: Generate today's and tomorrow's fixtures**

Run (substituting the actual current date and the following day):

```bash
npx tsx scripts/fetch-financials-data.ts 2026-08-01
npx tsx scripts/fetch-financials-data.ts 2026-08-02
```

Expected: each run prints `Generating <date>: <TICKER>` then `Wrote <date>.json + -answer.json`, with no thrown errors. If a run throws `No ticker with usable SEC revenue data found after 15 attempts`, that's the retry cap being hit for real (extremely unlikely given the 84%+ per-ticker hit rate found during design validation, but if it happens, re-run — `selectPuzzle`'s date-seeding is deterministic, so a genuinely stuck date needs `MAX_TICKER_RETRIES` raised, not a re-run).

- [ ] **Step 3: Inspect the generated payload**

```bash
cat public/games/2026-08-01.json
```

Verify: `revenueData` is an array of `{x, y}` objects with `x` values `"Q1"`, `"Q2"`, ... and real (non-zero, plausible) `y` numbers; `netIncomeTrend` is `"up"` or `"down"`; no `interval` or `candlestickData` field present.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all pass, including a clean production build

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, open `http://localhost:3000`, confirm:
- The chart renders as colored bars (not a blank chart or an error boundary).
- Making a wrong guess reveals sector at guess 1, and both market cap tier and the net income trend chip together at guess 2.
- The chart tooltip (hover) shows a dollar value at guess 3+.
- How to Play modal's copy matches the new revenue-chart mechanic.

- [ ] **Step 6: Commit**

```bash
git add public/games
git commit -m "Regenerate live puzzle fixtures under the new revenue-chart schema"
```

---

## Self-Review Notes (completed during plan authoring)

- **Spec coverage**: every section of the design spec (data source, output schema, frontend changes, script/CI changes, testing, migration) maps to a task above. The two "unverified assumption" items from the spec were already validated during brainstorming (see spec's "Validation performed during design" section) and their fixes (wider tag list, regression-slope trend) are baked into Tasks 2–4 directly rather than left as follow-ups.
- **Type consistency checked**: `RevenuePoint`, `GameDayPayload`, `SelectedPuzzle`, `SecFactUnit`, `Fetcher`, `TickerHistoryEntry` are defined once (Tasks 1–4) and referenced with matching names/shapes in every later task that consumes them.
- **No placeholders**: every step has literal code, not a description of code to write. The one deliberately-loose step (Task 6, Step 2, YAML validation) says exactly what to fall back to and why, rather than leaving it open-ended.
