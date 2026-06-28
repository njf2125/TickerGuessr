# TickerGuessr Phase 2: Automatic Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-curated game schedule + Yahoo Finance fetch with a fully automatic pipeline: tickers auto-rotate from the S&P 500 ∪ Nasdaq-100, never repeating within 180 days, with OHLC + metadata fetched from Alpha Vantage at three intervals (1h / 1d / 1w).

**Architecture:** Same static-JSON delivery as Phase 1 (client fetches `/games/${date}.json`; a GitHub Actions cron generates the daily file and commits it, which doubles as the deploy trigger). What changes is the generator: a periodically-refreshed answer pool (S&P 500 ∪ Nasdaq-100 constituents), a pure date-seeded selection function that excludes the trailing 180 days of tickers, and an Alpha Vantage data layer. The broad autocomplete list is regenerated from the free NASDAQ/NYSE symbol files with no market-cap calls. No human maintenance anywhere.

**Tech Stack:** Next.js 14 (unchanged app/UI), TypeScript strict, Vitest, Alpha Vantage REST API, GitHub Actions, `tsx` for scripts.

## Global Constraints

- Market data provider is **Alpha Vantage**. The API key comes from `process.env.ALPHAVANTAGE_API_KEY` — never hardcoded, never committed. Free key: https://www.alphavantage.co/support/#api-key. Free tier ≈ 25 requests/day, 5/min — the daily job makes ≤3 calls, so this is fine; nothing in this pipeline may bulk-scan the API.
- `CandleInterval` is exactly `'1h' | '1d' | '1w'`. No other interval may be produced.
- The **answer pool** is `S&P 500 ∪ Nasdaq-100` constituents (the indices, ~520 unique names after dedup), stored in `src/data/puzzle-pool.ts`. Every pool ticker MUST exist in `companies.ts` or the puzzle is unwinnable — enforced by a unit test.
- Daily selection is **date-seeded** (same `dateString` → same ticker+interval on re-run, so retries are idempotent) and **excludes every ticker used in the trailing 180 days** (read from existing `public/games/*.json`). The interval is also chosen by the seeded RNG.
- Tickers use **dot notation** for share classes (`BRK.B`) everywhere in the app/data. Alpha Vantage uses **dash** (`BRK-B`); convert with `toAlphaVantageSymbol()` before any AV call; store the dot form in the payload.
- Alpha Vantage returns HTTP 200 even when rate-limited or erroring, signalling it via a `Note`, `Information`, or `Error Message` field. The fetch layer MUST detect these and throw — never parse them as data.
- `companies.ts` (the autocomplete universe) is generated from the NASDAQ + NYSE symbol files only (ticker + name); **no market-cap filtering, no API calls**. It is broad on purpose — players may guess any listed company.
- Any module a `tsx` script imports (transitively) MUST use relative imports — `tsx` does not resolve the `@/` alias. This now includes `companies.ts` and `puzzle-pool.ts` (both imported by `fetch-game-data.ts`): their generated form uses `import { Company } from "../types/game"`.
- Zero live financial API calls at runtime — players only ever fetch the static JSON. Alpha Vantage is called solely by the build/generation scripts.
- Keep the GitHub Actions cron committing the daily JSON (it is also the deploy trigger). Do not introduce a database or blob store in this phase.

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `src/types/game.ts` | modify | `CandleInterval` becomes `'1h' \| '1d' \| '1w'` |
| `src/components/StockChart.tsx` | modify | `INTERVAL_LABELS` gains a `'1h'` entry |
| `src/data/companies.ts` | regenerate | Broad autocomplete list from symbol files; relative type import |
| `src/data/puzzle-pool.ts` | create (generated) | `PUZZLE_POOL: PoolEntry[]` — S&P 500 ∪ Nasdaq-100, relative type import |
| `src/data/puzzle-pool.test.ts` | create | Winnable guard: every pool ticker exists in `companies.ts` |
| `src/data/puzzle-selection.ts` | create (replaces `game-schedule.ts`) | Pure `selectPuzzle()` + date-seeded RNG + `GAME_START_DATE`/`gameIdFor` |
| `src/data/puzzle-selection.test.ts` | create (replaces `game-schedule.test.ts`) | Selection: excludes recent, in-pool, deterministic per date, exhaustion |
| `src/data/game-schedule.ts` | delete | Superseded by `puzzle-selection.ts` + `puzzle-pool.ts` |
| `src/data/game-schedule.test.ts` | delete | Superseded by the two test files above |
| `scripts/build-company-list.ts` | rewrite | Symbol-files-only; no AV/market-cap calls |
| `scripts/build-puzzle-pool.ts` | create | Fetch S&P 500 + Nasdaq-100 constituents → `puzzle-pool.ts` |
| `scripts/fetch-game-data.ts` | rewrite | Read 180-day history → select → fetch AV prices + cap → write JSON |
| `.github/workflows/daily-game.yml` | modify | AV API-key secret; keep daily cron; add monthly pool refresh |

---

## Task 1: Interval type + chart label (add 1h)

**Files:**
- Modify: `src/types/game.ts`
- Modify: `src/components/StockChart.tsx`

**Interfaces:**
- Produces: `CandleInterval = '1h' | '1d' | '1w'` consumed by every later task and the existing UI.

- [ ] **Step 1: Widen `CandleInterval`**

In `src/types/game.ts`, change the type:

```typescript
export type CandleInterval = '1h' | '1d' | '1w';
```

- [ ] **Step 2: Add the 1h label to the chart**

In `src/components/StockChart.tsx`, `INTERVAL_LABELS` is a `Record<CandleInterval, string>`, so it must cover every key or `tsc` fails. Update it:

```typescript
const INTERVAL_LABELS: Record<CandleInterval, string> = {
  "1h": "Hourly",
  "1d": "Daily",
  "1w": "Weekly",
};
```

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npm run lint
git add src/types/game.ts src/components/StockChart.tsx
git commit -m "feat: support 1h interval (type + chart label)"
```
Expected: clean tsc/lint. (No test yet — pure type/label change.)

---

## Task 2: Broad autocomplete list (symbol files only)

**Files:**
- Rewrite: `scripts/build-company-list.ts`
- Regenerate: `src/data/companies.ts`

**Interfaces:**
- Produces: `COMPANIES: Company[]` (broad, ticker+name), imported via the `@/` alias by app/tests AND (relative form) by `tsx` scripts. The generated file MUST start with `import { Company } from "../types/game";`.

> **Why relative import:** `fetch-game-data.ts` (run by `tsx`) transitively imports `companies.ts` for the winnability filter. `tsx` cannot resolve `@/`, so the generated file uses the relative path. App code importing `@/data/companies` still resolves fine.

- [ ] **Step 1: Rewrite `scripts/build-company-list.ts`**

This drops all Yahoo/Alpha Vantage market-cap logic. It only parses the two free NASDAQ Trader symbol files into ticker+name, normalizes share-class tickers to dot notation, dedupes, sorts, and writes `companies.ts`.

```typescript
import https from "https";
import fs from "fs/promises";
import path from "path";

async function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

// App convention is dot notation for share classes (BRK.B). Normalize any
// dash/slash separators the source uses to a dot.
function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-/]/g, ".");
}

function parseNasdaqListed(text: string): Array<{ ticker: string; name: string }> {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .filter((line) => {
      const cols = line.split("|");
      if (cols.length < 8) return false;
      const [, , , testIssue, financialStatus, , etf] = cols;
      return etf === "N" && testIssue === "N" && financialStatus === "N";
    })
    .map((line) => {
      const cols = line.split("|");
      return { ticker: normalizeTicker(cols[0]), name: cols[1].trim() };
    });
}

function parseOtherListed(text: string): Array<{ ticker: string; name: string }> {
  return text
    .trim()
    .split("\n")
    .slice(1)
    .filter((line) => {
      const cols = line.split("|");
      if (cols.length < 7) return false;
      return cols[4] === "N" && cols[6] === "N"; // ETF=N, testIssue=N
    })
    .map((line) => {
      const cols = line.split("|");
      return {
        ticker: normalizeTicker(cols[0]),
        name: cols[1]
          .replace(/ Common Stock.*/, "")
          .replace(/ - Class [A-Z]$/, "")
          .trim(),
      };
    });
}

async function main() {
  console.log("Fetching NASDAQ + NYSE symbol files...");
  const [nasdaqText, otherText] = await Promise.all([
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"),
    fetchText("https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"),
  ]);

  const map = new Map<string, string>();
  for (const c of [...parseOtherListed(otherText), ...parseNasdaqListed(nasdaqText)]) {
    if (/^[A-Z.]+$/.test(c.ticker)) map.set(c.ticker, c.name); // drop warrants/units with odd symbols
  }
  const companies = Array.from(map.entries())
    .map(([ticker, name]) => ({ ticker, name }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const output = [
    'import { Company } from "../types/game";',
    "",
    "// Generated by scripts/build-company-list.ts — do not edit manually.",
    "// Source: NASDAQ + NYSE symbol files (ticker + name only). Broad autocomplete universe.",
    "// Re-run: npx tsx scripts/build-company-list.ts",
    `export const COMPANIES: Company[] = ${JSON.stringify(companies, null, 2)};`,
  ].join("\n");

  const outPath = path.join(process.cwd(), "src/data/companies.ts");
  await fs.writeFile(outPath, output);
  console.log(`Wrote ${companies.length} companies to src/data/companies.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Regenerate `companies.ts`**

```bash
npx tsx scripts/build-company-list.ts
```
Expected: several thousand entries; file begins with `import { Company } from "../types/game";`.

- [ ] **Step 3: Verify the app still compiles**

```bash
npx tsc --noEmit
npm run lint
```
Expected: clean. (`@/data/companies` consumers are unaffected by the now-relative internal import.)

- [ ] **Step 4: Commit**

```bash
git add scripts/build-company-list.ts src/data/companies.ts
git commit -m "feat: regenerate broad autocomplete list from symbol files (no market-cap calls)"
```

---

## Task 3: Answer pool (S&P 500 ∪ Nasdaq-100)

**Files:**
- Create: `scripts/build-puzzle-pool.ts`
- Create (generated): `src/data/puzzle-pool.ts`
- Create: `src/data/puzzle-pool.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface PoolEntry { ticker: string; name: string; sector: string }
  export const PUZZLE_POOL: PoolEntry[];
  ```
  Generated file MUST start with `import { ... } from "../types/game"` only if it needs a type; `PoolEntry` is declared locally in `puzzle-pool.ts` to keep it self-contained and tsx-resolvable. (No `@/` import.)

- [ ] **Step 1: Write `scripts/build-puzzle-pool.ts`**

Fetches the S&P 500 and Nasdaq-100 constituent tables from Wikipedia (free, no key), parses ticker + name + GICS sector, normalizes tickers to dot notation, dedupes by ticker, and writes `src/data/puzzle-pool.ts`. Wikipedia tables are the standard free constituent source; the script is defensive about column positions and fails loudly if a table can't be parsed (the existing pool keeps working until fixed).

```typescript
import https from "https";
import fs from "fs/promises";
import path from "path";

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "TickerGuessr/1.0 (pool builder)" } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-/]/g, ".");
}

// Strip HTML tags/entities from a Wikipedia table cell.
function clean(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

interface PoolEntry { ticker: string; name: string; sector: string }

// Parse the first sortable wikitable on the page; map columns by header text so
// minor layout shifts don't break us.
function parseWikiTable(
  html: string,
  cols: { ticker: string; name: string; sector: string }
): PoolEntry[] {
  const tableMatch = html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/);
  if (!tableMatch) throw new Error("no wikitable found");
  const table = tableMatch[0];
  const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const header = (rows[0].match(/<th[\s\S]*?<\/th>/g) ?? []).map((h) => clean(h).toLowerCase());
  const idxOf = (label: string) => header.findIndex((h) => h.includes(label));
  const ti = idxOf(cols.ticker), ni = idxOf(cols.name), si = idxOf(cols.sector);
  if (ti < 0 || ni < 0 || si < 0) throw new Error(`header mismatch: ${header.join(" | ")}`);

  const out: PoolEntry[] = [];
  for (const row of rows.slice(1)) {
    const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map(clean);
    if (cells.length <= Math.max(ti, ni, si)) continue;
    const ticker = normalizeTicker(cells[ti]);
    if (!/^[A-Z.]+$/.test(ticker)) continue;
    out.push({ ticker, name: cells[ni], sector: cells[si] || "Unknown" });
  }
  return out;
}

async function main() {
  console.log("Fetching S&P 500 + Nasdaq-100 constituents...");
  const [sp, nd] = await Promise.all([
    fetchText("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"),
    fetchText("https://en.wikipedia.org/wiki/Nasdaq-100"),
  ]);

  const spEntries = parseWikiTable(sp, { ticker: "symbol", name: "security", sector: "gics sector" });
  const ndEntries = parseWikiTable(nd, { ticker: "ticker", name: "company", sector: "gics sector" });
  console.log(`S&P 500: ${spEntries.length}, Nasdaq-100: ${ndEntries.length}`);
  if (spEntries.length < 400) throw new Error("S&P 500 parse looks wrong (<400 rows)");

  const map = new Map<string, PoolEntry>();
  for (const e of [...spEntries, ...ndEntries]) map.set(e.ticker, e); // dedupe by ticker
  const pool = Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  console.log(`Pool (deduped): ${pool.length} tickers`);

  const output = [
    "// Generated by scripts/build-puzzle-pool.ts — do not edit manually.",
    "// Source: Wikipedia S&P 500 + Nasdaq-100 constituent tables. Recognizable large-caps.",
    "// Re-run: npx tsx scripts/build-puzzle-pool.ts",
    "export interface PoolEntry {",
    "  ticker: string;",
    "  name: string;",
    "  sector: string;",
    "}",
    "",
    `export const PUZZLE_POOL: PoolEntry[] = ${JSON.stringify(pool, null, 2)};`,
  ].join("\n");

  await fs.writeFile(path.join(process.cwd(), "src/data/puzzle-pool.ts"), output);
  console.log(`Wrote ${pool.length} entries to src/data/puzzle-pool.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Generate the pool**

```bash
npx tsx scripts/build-puzzle-pool.ts
```
Expected: `Pool (deduped): ~500+ tickers`, written to `src/data/puzzle-pool.ts`.

> If Wikipedia's table layout has shifted and parsing fails, the script throws with the header it saw — adjust the column label matchers (`symbol`/`security`/`gics sector`, `ticker`/`company`) accordingly. This is the only brittle external dependency; it runs monthly, and a failure leaves the existing pool intact.

- [ ] **Step 3: Write the winnable-guard test `src/data/puzzle-pool.test.ts`**

This is the Phase-2 equivalent of the old schedule winnability test: every answer the game can serve must be typeable in the autocomplete.

```typescript
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
```

Run: `npm test`
Expected: pass. If the "winnable" test fails, a handful of pool tickers (often ADRs or very recent index changes) aren't in the symbol-file list — re-run `build-company-list.ts`, and if still missing, those tickers will simply be filtered out at selection time (Task 4 intersects with `companies.ts`), so the test failure is a signal, not a hard block. Keep the test green by re-running both generators together.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-puzzle-pool.ts src/data/puzzle-pool.ts src/data/puzzle-pool.test.ts
git commit -m "feat: add auto-generated S&P 500 + Nasdaq-100 answer pool with winnable test"
```

---

## Task 4: Pure selection logic (date-seeded, 180-day exclusion)

**Files:**
- Create: `src/data/puzzle-selection.ts`
- Create: `src/data/puzzle-selection.test.ts`
- Delete: `src/data/game-schedule.ts`, `src/data/game-schedule.test.ts`

**Interfaces:**
- Consumes: `PUZZLE_POOL` (relative import), `COMPANIES` (relative import).
- Produces:
  ```typescript
  export const GAME_START_DATE = "2026-06-25";
  export interface SelectedPuzzle { ticker: string; name: string; sector: string; interval: CandleInterval }
  export function gameIdFor(dateString: string): number;
  export function selectPuzzle(dateString: string, recentlyUsed: Set<string>): SelectedPuzzle;
  ```
  `selectPuzzle` is pure and deterministic given its inputs (it derives its RNG from `dateString`), so the same date + same history always yields the same puzzle.

- [ ] **Step 1: Write the failing test `src/data/puzzle-selection.test.ts`**

```typescript
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
    expect(["1h", "1d", "1w"]).toContain(p.interval);
  });

  it("gameId is day-offset + 1 from the start date", () => {
    expect(gameIdFor(GAME_START_DATE)).toBe(1);
    expect(gameIdFor("2026-06-26")).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './puzzle-selection'`.

- [ ] **Step 3: Write `src/data/puzzle-selection.ts`**

```typescript
import { CandleInterval } from "../types/game";
import { PUZZLE_POOL } from "./puzzle-pool";
import { COMPANIES } from "./companies";

export const GAME_START_DATE = "2026-06-25";
const INTERVALS: CandleInterval[] = ["1h", "1d", "1w"];

export interface SelectedPuzzle {
  ticker: string;
  name: string;
  sector: string;
  interval: CandleInterval;
}

// Only pool entries that are actually typeable in the autocomplete are eligible.
const ELIGIBLE = PUZZLE_POOL.filter(
  (e) => new Set(COMPANIES.map((c) => c.ticker)).has(e.ticker)
);

// Deterministic string -> 32-bit seed (xmur3) and PRNG (mulberry32).
function seedFrom(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
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
  let candidates = ELIGIBLE.filter((e) => !recentlyUsed.has(e.ticker));
  // Safety net: if the 180-day window somehow excluded everything, ignore it.
  if (candidates.length === 0) candidates = ELIGIBLE;
  if (candidates.length === 0) {
    throw new Error("No eligible puzzle tickers — pool ∩ companies is empty.");
  }
  const entry = candidates[Math.floor(rng() * candidates.length)];
  const interval = INTERVALS[Math.floor(rng() * INTERVALS.length)];
  return { ticker: entry.ticker, name: entry.name, sector: entry.sector, interval };
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS (`selectPuzzle` 5 tests + `puzzle-pool` 3 tests).

- [ ] **Step 5: Delete the superseded schedule files**

```bash
git rm src/data/game-schedule.ts src/data/game-schedule.test.ts
```
Then grep to confirm nothing still imports them: `grep -rn "game-schedule" src scripts` → expect no matches (Task 5 rewrites the only importer).

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npm test
git add src/data/puzzle-selection.ts src/data/puzzle-selection.test.ts
git commit -m "feat: add pure date-seeded puzzle selection with 180-day exclusion; remove old schedule"
```

---

## Task 5: Alpha Vantage fetch + history-aware generation

**Files:**
- Rewrite: `scripts/fetch-game-data.ts`
- Create: `scripts/fetch-game-data.test.ts` (pure helpers)

**Interfaces:**
- Consumes: `selectPuzzle`, `gameIdFor`, `GAME_START_DATE` (relative), `GameDayPayload`/`OHLCPoint`/`CandleInterval` types (relative).
- Produces: `public/games/${date}.json` (`GameDayPayload`, unchanged shape).
- Produces pure, testable helpers: `toAlphaVantageSymbol`, `recentlyUsedTickers`, `parseSeries`, `barLabel`.

- [ ] **Step 1: Write the failing helper test `scripts/fetch-game-data.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { toAlphaVantageSymbol, parseSeries, barLabel } from "./fetch-game-data";

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
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './fetch-game-data'` (or the named exports are undefined).

- [ ] **Step 3: Write `scripts/fetch-game-data.ts`**

```typescript
import https from "https";
import fs from "fs/promises";
import path from "path";
import {
  selectPuzzle,
  gameIdFor,
} from "../src/data/puzzle-selection";
import type { GameDayPayload, OHLCPoint, CandleInterval } from "../src/types/game";

const API_KEY = process.env.ALPHAVANTAGE_API_KEY;
const BASE = "https://www.alphavantage.co/query";
const HISTORY_WINDOW_DAYS = 180;

export function toAlphaVantageSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

export function barLabel(index: number, interval: CandleInterval): string {
  if (interval === "1w") return `Wk ${index + 1}`;
  if (interval === "1h") return `Hr ${index + 1}`;
  return `Day ${index + 1}`;
}

function getJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

// Alpha Vantage signals throttling/errors via these keys (with HTTP 200).
function assertNotThrottled(res: Record<string, unknown>): void {
  for (const k of ["Note", "Information", "Error Message"]) {
    if (res[k]) throw new Error(`Alpha Vantage: ${String(res[k])}`);
  }
}

type AVSeries = Record<string, Record<string, string>>;

export function parseSeries(series: AVSeries, interval: CandleInterval, count: number): OHLCPoint[] {
  const entries = Object.entries(series); // AV returns newest-first
  if (entries.length === 0) throw new Error("empty Alpha Vantage series (throttled or bad symbol?)");
  const oldestFirst = entries
    .sort(([a], [b]) => a.localeCompare(b)) // chronological
    .slice(-count);
  return oldestFirst.map(([, ohlc], i) => ({
    x: barLabel(i, interval),
    y: [
      Math.round(Number(ohlc["1. open"]) * 100) / 100,
      Math.round(Number(ohlc["2. high"]) * 100) / 100,
      Math.round(Number(ohlc["3. low"]) * 100) / 100,
      Math.round(Number(ohlc["4. close"]) * 100) / 100,
    ],
  }));
}

function seriesKeyFor(interval: CandleInterval): { fn: string; key: string; extra: string } {
  if (interval === "1w") return { fn: "TIME_SERIES_WEEKLY", key: "Weekly Time Series", extra: "" };
  if (interval === "1h")
    return {
      fn: "TIME_SERIES_INTRADAY",
      key: "Time Series (60min)",
      extra: "&interval=60min&outputsize=compact&extended_hours=false",
    };
  return { fn: "TIME_SERIES_DAILY", key: "Time Series (Daily)", extra: "&outputsize=compact" };
}

function getMarketCapTier(cap: number): string {
  if (cap >= 200_000_000_000) return "Mega Cap";
  if (cap >= 10_000_000_000) return "Large Cap";
  if (cap >= 2_000_000_000) return "Mid Cap";
  return "Small Cap";
}

// Read the trailing 180 days of generated game files to get recently-used tickers.
export async function recentlyUsedTickers(targetDate: string, gamesDir: string): Promise<Set<string>> {
  const used = new Set<string>();
  let files: string[] = [];
  try {
    files = await fs.readdir(gamesDir);
  } catch {
    return used; // no games yet
  }
  const target = new Date(targetDate).getTime();
  const windowMs = HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const d = new Date(f.replace(".json", "")).getTime();
    if (isNaN(d)) continue;
    if (d < target && target - d <= windowMs) {
      try {
        const payload = JSON.parse(await fs.readFile(path.join(gamesDir, f), "utf8"));
        if (payload?.ticker) used.add(payload.ticker);
      } catch {
        /* skip unreadable */
      }
    }
  }
  return used;
}

async function generateGameFile(dateString: string): Promise<void> {
  if (!API_KEY) throw new Error("ALPHAVANTAGE_API_KEY is not set");
  const gamesDir = path.join(process.cwd(), "public", "games");
  const recent = await recentlyUsedTickers(dateString, gamesDir);
  const puzzle = selectPuzzle(dateString, recent);
  const avSymbol = toAlphaVantageSymbol(puzzle.ticker);
  console.log(`Generating ${dateString}: ${puzzle.ticker} (${puzzle.interval})`);

  const { fn, key, extra } = seriesKeyFor(puzzle.interval);
  const priceRes = await getJson(`${BASE}?function=${fn}&symbol=${avSymbol}${extra}&apikey=${API_KEY}`);
  assertNotThrottled(priceRes);
  const series = priceRes[key] as AVSeries | undefined;
  if (!series) throw new Error(`missing "${key}" in Alpha Vantage response for ${puzzle.ticker}`);
  const candlestickData = parseSeries(series, puzzle.interval, 30);
  if (candlestickData.length < 10) {
    throw new Error(`only ${candlestickData.length} bars for ${puzzle.ticker}`);
  }

  // OVERVIEW for market cap (sector + name come from the curated pool).
  const overview = await getJson(`${BASE}?function=OVERVIEW&symbol=${avSymbol}&apikey=${API_KEY}`);
  assertNotThrottled(overview);
  const marketCap = Number(overview["MarketCapitalization"] ?? 0);

  const payload: GameDayPayload = {
    gameId: gameIdFor(dateString),
    dateString,
    ticker: puzzle.ticker,
    companyName: puzzle.name,
    interval: puzzle.interval,
    sector: puzzle.sector,
    marketCapTier: getMarketCapTier(marketCap),
    triviaHints: [
      `TODO: trivia hint 1 for ${puzzle.ticker}`,
      `TODO: trivia hint 2 for ${puzzle.ticker}`,
    ],
    candlestickData,
  };

  const outPath = path.join(gamesDir, `${dateString}.json`);
  await fs.mkdir(gamesDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
  console.log(`⚠️  Fill in triviaHints for ${puzzle.ticker} before ${dateString} goes live.`);
}

// Usage: npx tsx scripts/fetch-game-data.ts [YYYY-MM-DD]  (defaults to tomorrow, UTC)
async function main() {
  const arg = process.argv[2];
  let date: string;
  if (arg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      console.error("Usage: npx tsx scripts/fetch-game-data.ts [YYYY-MM-DD]");
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

// Only run main() when invoked directly, so the test file can import the pure helpers.
if (process.argv[1] && process.argv[1].includes("fetch-game-data")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the helper tests**

Run: `npm test`
Expected: PASS (`fetch-game-data helpers` 4 tests + selection + pool).

- [ ] **Step 5: Generate real fixtures (one per interval)**

Obtain a free Alpha Vantage key and export it, then generate three real puzzles to prove all intervals work end to end. (If the key or network is unavailable, write three clearly-labelled synthetic fixtures by hand instead — same `GameDayPayload` shape, 30 bars, plausible values — and note them in the report; regenerate for real later.)

```bash
export ALPHAVANTAGE_API_KEY=YOUR_FREE_KEY
npx tsx scripts/fetch-game-data.ts 2026-06-29
npx tsx scripts/fetch-game-data.ts 2026-06-30
npx tsx scripts/fetch-game-data.ts 2026-07-01
```
Expected: three files in `public/games/`. Confirm at least one resolved to each of `1h`, `1d`, `1w` across a few dates (re-run different dates if needed — interval is seeded per date). Spot-check shapes:
```bash
node -e "const d=require('./public/games/2026-06-29.json');console.log(d.ticker,d.interval,d.sector,d.marketCapTier,d.candlestickData.length)"
```

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-game-data.ts scripts/fetch-game-data.test.ts public/games/
git commit -m "feat: Alpha Vantage fetch with history-aware date-seeded selection (1h/1d/1w)"
```

---

## Task 6: GitHub Actions — API key secret + monthly pool refresh

**Files:**
- Modify: `.github/workflows/daily-game.yml`

- [ ] **Step 1: Wire the Alpha Vantage key and keep the daily commit**

Add the API key as a repo secret first (one-time, outside this plan):
`gh secret set ALPHAVANTAGE_API_KEY` (paste the free key).

Update the daily job's generate step to pass the key via `env` (so it's never echoed into the shell line), keeping the existing injection-safe `TARGET_DATE` pattern:

```yaml
      - name: Generate game file
        env:
          ALPHAVANTAGE_API_KEY: ${{ secrets.ALPHAVANTAGE_API_KEY }}
          TARGET_DATE: ${{ github.event.inputs.date || '' }}
        run: npx tsx scripts/fetch-game-data.ts "$TARGET_DATE"
```
The `stefanzweifel/git-auto-commit-action` commit step stays exactly as-is (the commit is also the deploy trigger).

- [ ] **Step 2: Add a monthly pool-refresh job to the same file**

Append a second job that regenerates the answer pool + autocomplete list monthly and commits any changes:

```yaml
  refresh-pool:
    if: github.event_name == 'schedule'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Refresh pool + autocomplete (first of month only)
        run: |
          if [ "$(date -u +%d)" = "01" ]; then
            npx tsx scripts/build-company-list.ts
            npx tsx scripts/build-puzzle-pool.ts
          else
            echo "Not the 1st — skipping pool refresh."
          fi
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: monthly refresh of company list + puzzle pool'
          file_pattern: 'src/data/companies.ts src/data/puzzle-pool.ts'
```

(The daily `cron: '0 6 * * *'` trigger already runs every day; the `date -u +%d` guard limits the heavy refresh to the 1st.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-game.yml
git commit -m "ci: wire Alpha Vantage key; add monthly pool/autocomplete refresh"
```

---

## Task 7: Full verification

**Files:** none — verification only.

- [ ] **Step 1: Suite + types + lint + build**

```bash
npm test            # puzzle-pool (3) + selectPuzzle (5) + fetch helpers (4) + stats (4) + share (3)
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all green; build succeeds.

- [ ] **Step 2: Confirm no stale references**

```bash
grep -rn "game-schedule\|yahoo-finance2\|getScheduleEntry" src scripts
```
Expected: no matches (Yahoo and the old schedule are fully removed). If `yahoo-finance2` is now unused, remove it: `npm uninstall yahoo-finance2` and commit the `package.json`/lockfile change.

- [ ] **Step 3: Static serving + interval rendering**

With `npm run dev` running, fetch a generated file and load the app on a date that has a fixture; verify the chart renders for a `1h` puzzle (hourly bars, "Hourly" badge after guess 1) as well as `1d`/`1w`.

```bash
curl -o /dev/null -s -w "%{http_code}\n" "http://localhost:3000/games/2026-06-29.json"   # 200
curl -o /dev/null -s -w "%{http_code}\n" "http://localhost:3000/games/2099-01-01.json"     # 404
```

- [ ] **Step 4: Selection-rotation sanity**

```bash
node -e "const {selectPuzzle}=require('tsx/cjs/api').require('./src/data/puzzle-selection.ts',__filename); /* or run via tsx */"
```
Simpler: write a throwaway tsx snippet that prints `selectPuzzle` for 10 consecutive dates with an accumulating used-set and confirm no ticker repeats. Delete it after.

- [ ] **Step 5: Final commit (if anything changed)**

```bash
git add -A
git status
git commit -m "chore: phase 2 verification — automatic Alpha Vantage pipeline green" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Provider = Alpha Vantage, key from env secret | Task 5, Task 6 |
| Intervals 1h / 1d / 1w (no 4h) | Task 1, Task 4, Task 5 |
| Answer pool = S&P 500 ∪ Nasdaq-100, auto-refreshed | Task 3, Task 6 |
| Recognizable by construction (index membership) | Task 3 |
| Fully automatic daily rotation, no hand-maintenance | Task 4, Task 5 |
| Never reuse a ticker within 180 days | Task 5 (`recentlyUsedTickers`) + Task 4 (`selectPuzzle`) |
| Deterministic/idempotent per date | Task 4 (date-seeded RNG) |
| Every served ticker is winnable | Task 3 (winnable test) + Task 4 (pool ∩ companies filter) |
| Broad autocomplete, no market-cap calls | Task 2 |
| Metadata fetched automatically (sector from pool, cap from AV) | Task 3, Task 5 |
| AV throttle/error detection | Task 5 (`assertNotThrottled`, `parseSeries` throw) |
| tsx-safe relative imports in generated data modules | Task 2, Task 3 |
| Keep GitHub Actions cron + commit (deploy trigger) | Task 6 |
| Zero runtime API calls | unchanged (client fetches static JSON) |
| Yahoo fully removed | Task 7 |

**Type consistency:**
- `CandleInterval = '1h' | '1d' | '1w'` — defined Task 1, used in `INTERVAL_LABELS` (Task 1), `barLabel`/`seriesKeyFor` (Task 5), `selectPuzzle` (Task 4).
- `SelectedPuzzle { ticker, name, sector, interval }` — produced Task 4, consumed by `fetch-game-data.ts` Task 5.
- `PoolEntry { ticker, name, sector }` — defined Task 3, consumed Task 4.
- `GameDayPayload` shape — unchanged from Phase 1; `fetch-game-data.ts` still emits exactly it.
- `gameIdFor(dateString)` — defined Task 4, used Task 5 (replaces the old inline gameId math).

**Carry-over from Phase 1 (not addressed here, still logged in `.superpowers/sdd/final-review.md`):** localStorage write-guard, stats schema validation on load, StatsModal `setTimeout` cleanup — independent of the data layer; fold into a later polish pass.

## Operational Notes & Known Risks

- **Wikipedia is the one brittle dependency.** `build-puzzle-pool.ts` scrapes two Wikipedia tables. They're stable but can change layout; the script fails loudly and the *existing* pool keeps working until fixed. If it proves flaky, swap to a provider constituents endpoint (e.g. FMP's free `/sp500_constituent` + `/nasdaq_constituent`).
- **Alpha Vantage free tier ≈ 25 req/day.** The daily job uses ≤3. Never add a step that loops the API over many symbols (that's why the pool uses index membership, not a market-cap scan, and why `companies.ts` comes from symbol files).
- **1h history depth.** `TIME_SERIES_INTRADAY` `outputsize=compact` returns ~100 most-recent 60-min bars (~2–3 trading weeks) — ample for 30 bars. For a specific past date you'd need the `month=YYYY-MM` parameter; the daily forward-generation case doesn't.
- **Unadjusted prices.** `TIME_SERIES_DAILY`/`WEEKLY` free are unadjusted (same as the old Yahoo `chart()` path), so a split inside a weekly window can still show a cliff. Editorial, per-puzzle — acceptable; the chart is anonymized.
- **Answer is still client-visible** (static JSON), and the cron generates only ~1 day ahead — don't pre-generate weeks of files.
