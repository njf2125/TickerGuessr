# Progressive Chart Reveal + Visual Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static 28-bar revenue chart into a progressive reveal that changes on nearly every guess, and make it legible and bold on a phone screen.

**Architecture:** The reveal math and bar-coloring become exported pure functions in a new `src/components/chart-reveal.ts`, unit-tested without a DOM. `StockChart.tsx` consumes them and gets a visual overhaul (no axis labels, taller, rounded bold bars, animated reveals, real card header). Separately, the SEC fetch script's single shared quarter cap is split in two so shortening the chart doesn't silently change the net-income trend hint.

**Tech Stack:** Next.js 14 / React, ApexCharts (`react-apexcharts`), TypeScript, Vitest, `tsx` for scripts.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-08-10-progressive-chart-reveal-design.md` — read it if anything below is ambiguous.
- **Anonymization properties are load-bearing and must survive** (each was a deliberate prior decision): `dataLabels: { enabled: false }` (bar charts default to printing values *on* bars), `yaxis.labels.show: false`, tooltip gated at `guessCount >= 3`, and no real dates anywhere in payload or UI.
- Reveal formula is exactly `min(4 + guessCount * 2, 12, dataLength)`. The step of **2, not 4**, is deliberate: `MAX_ATTEMPTS` is 6, so a step of 4 would freeze the chart from guess 2 onward — four of six stages — recreating the static-chart problem this work exists to fix. Do not "optimize" this.
- Bar color compares against the predecessor in the **full** array, never the visible slice, so colors never change as more bars reveal.
- `MAX_REVENUE_QUARTERS = 12` (chart) and `MAX_TREND_QUARTERS = 28` (net-income trend analysis) must stay separate constants. Collapsing them back into one silently changes a player-facing hint.
- Existing 28-entry fixtures in `public/games/` must keep rendering correctly with no migration.
- The existing text-hint reveal curve (`HintContainer.tsx`) is **not** re-timed by this work.

---

### Task 1: Decouple the revenue and net-income quarter caps

**Files:**
- Modify: `scripts/fetch-financials-data.ts`
- Modify: `scripts/fetch-financials-data.test.ts`

**Interfaces:**
- Produces: `MAX_REVENUE_QUARTERS` (12) and `MAX_TREND_QUARTERS` (28) exported constants; `extractQuarterlySeries(units, maxQuarters)` and `fetchConceptWithFallback(fetcher, cik, tags, maxQuarters)` both gain a required trailing cap argument.

Why this is its own task: it's a data-pipeline change with no UI dependency, and it's the one piece of this work that could silently alter an existing player-facing hint if done wrong.

- [ ] **Step 1: Write the failing test**

In `scripts/fetch-financials-data.test.ts`, add to the existing `describe("extractQuarterlySeries", ...)` block:

```ts
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
```

Add `MAX_REVENUE_QUARTERS` and `MAX_TREND_QUARTERS` to the existing import from `"./fetch-financials-data"`.

Also update the two existing `extractQuarterlySeries` calls in that file to pass a cap — they use 8–9 entry fixtures that never reach either cap, so the assertions are unchanged:

```ts
    const result = extractQuarterlySeries(units, MAX_REVENUE_QUARTERS);
```
```ts
    expect(extractQuarterlySeries(units, MAX_REVENUE_QUARTERS)).toBeNull();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: FAIL — `MAX_REVENUE_QUARTERS`/`MAX_TREND_QUARTERS` are not exported

- [ ] **Step 3: Thread the cap through**

In `scripts/fetch-financials-data.ts`, replace the constant declaration:

```ts
const MAX_QUARTERS_KEPT = 28;
```

with:

```ts
// Two separate caps on purpose. extractQuarterlySeries runs for BOTH revenue and
// net income, so a single shared cap would mean shortening the chart also shortens
// the series trendDirection regresses over — turning a ~7-year profitability trend
// into a ~3-year one, which can flip the player-facing hint for a company that
// recently turned profitable. Presentation and analysis windows stay independent.
export const MAX_REVENUE_QUARTERS = 12; // what the chart displays
export const MAX_TREND_QUARTERS = 28; // what the net-income trend is computed over
```

Change `extractQuarterlySeries` to take the cap:

```ts
export function extractQuarterlySeries(
  units: SecFactUnit[],
  maxQuarters: number
): SecFactUnit[] | null {
  const quarterly = units.filter(
    (u) => (u.form === "10-Q" || u.form === "10-K") && isSingleQuarterSpan(u.start, u.end)
  );
  const deduped = dedupeByPeriod(quarterly).sort((a, b) => a.end.localeCompare(b.end));
  if (deduped.length < MIN_USABLE_QUARTERS) return null;
  return deduped.slice(-maxQuarters);
}
```

Change `fetchConceptWithFallback` to accept and forward it — update its signature line and the one `extractQuarterlySeries` call inside it:

```ts
export async function fetchConceptWithFallback(
  fetcher: Fetcher,
  cik: string,
  tags: string[],
  maxQuarters: number
): Promise<SecFactUnit[] | null> {
```
```ts
    const series = extractQuarterlySeries(units, maxQuarters);
```

In `pickPuzzleWithData`, pass the matching cap at each of the two call sites:

```ts
      const revenue = await fetchConceptWithFallback(fetcher, cik, REVENUE_TAGS, MAX_REVENUE_QUARTERS);
      if (revenue) {
        const netIncome = await fetchConceptWithFallback(fetcher, cik, NET_INCOME_TAGS, MAX_TREND_QUARTERS);
```

- [ ] **Step 4: Update the existing fetchConceptWithFallback tests**

The three tests in `describe("fetchConceptWithFallback", ...)` call it with three arguments. Add a fourth to each. The first test (`falls back to the next tag...`) and the throttling test both need `MAX_REVENUE_QUARTERS`:

```ts
    const result = await fetchConceptWithFallback(fetcher, "0000320193", [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ], MAX_REVENUE_QUARTERS);
```
```ts
    const result = await fetchConceptWithFallback(fetcher, "0000000000", ["Revenues"], MAX_REVENUE_QUARTERS);
```
```ts
    await expect(
      fetchConceptWithFallback(fetcher, "0000320193", ["Revenues"], MAX_REVENUE_QUARTERS)
    ).rejects.toThrow(/throttled/i);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run scripts/fetch-financials-data.test.ts`
Expected: PASS (23 tests — 22 existing + 1 new)

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-financials-data.ts scripts/fetch-financials-data.test.ts
git commit -m "Decouple revenue chart window from net-income trend window"
```

---

### Task 2: Pure reveal + coloring logic

**Files:**
- Create: `src/components/chart-reveal.ts`
- Create: `src/components/chart-reveal.test.ts`

**Interfaces:**
- Consumes: `RevenuePoint` from `@/types/game`.
- Produces: `MAX_VISIBLE_QUARTERS` (12), `UP_COLOR`, `DOWN_COLOR`, `visibleQuarterCount(guessCount, dataLength): number`, `visibleSlice(data, visibleCount): RevenuePoint[]`, `barColorsForVisible(data, visibleCount): string[]`. Task 3 imports all of these.

Separate from the component because ApexCharts is dynamically imported with `ssr: false` and needs a DOM — the logic worth testing must live outside it.

- [ ] **Step 1: Write the failing tests**

Create `src/components/chart-reveal.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/chart-reveal.test.ts`
Expected: FAIL — `./chart-reveal` does not exist

- [ ] **Step 3: Write the implementation**

Create `src/components/chart-reveal.ts`:

```ts
import type { RevenuePoint } from "@/types/game";

export const MAX_VISIBLE_QUARTERS = 12;
export const UP_COLOR = "#22c55e";
export const DOWN_COLOR = "#ef4444";

const BASE_VISIBLE = 4;
const REVEAL_STEP = 2;

// Step is 2, not 4, on purpose: MAX_ATTEMPTS is 6, so a step of 4 would hit the
// 12-quarter cap by guess 2 and leave the chart frozen for four of six stages —
// exactly the "static wallpaper" problem the progressive reveal exists to fix,
// just delayed to when the game gets hard. See the design doc.
export function visibleQuarterCount(guessCount: number, dataLength: number): number {
  return Math.min(BASE_VISIBLE + guessCount * REVEAL_STEP, MAX_VISIBLE_QUARTERS, dataLength);
}

// Reveals backwards in time: the newest quarters are always on screen and never
// shift position, older history fills in leftward.
export function visibleSlice(data: RevenuePoint[], visibleCount: number): RevenuePoint[] {
  return data.slice(Math.max(0, data.length - visibleCount));
}

// Each bar is compared against its predecessor in the FULL array, never the
// visible slice — otherwise the leftmost visible bar (which has no visible
// predecessor) would flip color the moment more bars appear. A consequence worth
// knowing: the leftmost bar's color references a quarter the player can't see yet.
// Stable colors beat verifiable ones.
export function barColorsForVisible(data: RevenuePoint[], visibleCount: number): string[] {
  const startIdx = Math.max(0, data.length - visibleCount);
  return data.slice(startIdx).map((point, i) => {
    const fullIdx = startIdx + i;
    if (fullIdx === 0) return UP_COLOR; // no predecessor at all
    return point.y >= data[fullIdx - 1].y ? UP_COLOR : DOWN_COLOR;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/chart-reveal.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/chart-reveal.ts src/components/chart-reveal.test.ts
git commit -m "Add pure progressive-reveal and bar-coloring logic"
```

---

### Task 3: Rewire StockChart with progressive reveal and visual overhaul

**Files:**
- Modify: `src/components/StockChart.tsx`

**Interfaces:**
- Consumes: everything Task 2 produces; `RevenuePoint` from `@/types/game`. Props are unchanged (`data`, `guessCount`), so `src/app/page.tsx` needs no edit.

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `src/components/StockChart.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { RevenuePoint } from "@/types/game";
import {
  visibleQuarterCount,
  visibleSlice,
  barColorsForVisible,
} from "./chart-reveal";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface StockChartProps {
  data: RevenuePoint[];
  guessCount: number;
}

export function StockChart({ data, guessCount }: StockChartProps) {
  const visibleCount = visibleQuarterCount(guessCount, data.length);
  const visible = useMemo(() => visibleSlice(data, visibleCount), [data, visibleCount]);
  const colors = useMemo(() => barColorsForVisible(data, visibleCount), [data, visibleCount]);
  const isFullyRevealed = visibleCount >= data.length;

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "bar",
        background: "transparent",
        toolbar: { show: false },
        // Animations are ON so newly revealed quarters grow in rather than
        // silently appearing — the reveal is the reward, it needs to be felt.
        animations: { enabled: true, speed: 400 },
      },
      theme: { mode: "dark" },
      grid: {
        show: true,
        borderColor: "#1f2937",
        padding: { left: 4, right: 4 },
      },
      xaxis: {
        categories: visible.map((d) => d.x),
        // Labels are deliberately hidden: the x values are synthetic sequential
        // placeholders (real filing dates are withheld for anonymization), so
        // rendering them was pure visual noise at any density.
        labels: { show: false },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        labels: { show: false },
      },
      // Bar charts default dataLabels to visible, which would print the real
      // revenue value on every bar regardless of guess count — must stay off to
      // preserve anonymization until the tooltip unlocks at guess 3.
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
          // distributed: true is required for the per-bar `colors` array below to
          // apply — without it every bar uses colors[0] only.
          distributed: true,
          columnWidth: "62%",
          borderRadius: 4,
          borderRadiusApplication: "end",
        },
      },
      states: {
        hover: { filter: { type: "lighten", value: 0.08 } },
        active: { filter: { type: "none" } },
      },
      colors,
    }),
    [guessCount, visible, colors]
  );

  const series = useMemo(
    () => [{ name: "Revenue", data: visible.map((d) => d.y) }],
    [visible]
  );

  return (
    <div className="w-full rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Quarterly Revenue
        </span>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {isFullyRevealed ? "full history" : `last ${visibleCount} quarters`}
        </span>
      </div>
      <ApexChart type="bar" series={series} options={options} height={300} width="100%" />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, and run the full suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all clean; test count is 47 (38 existing + 1 from Task 1 + 8 from Task 2)

- [ ] **Step 3: Commit**

```bash
git add src/components/StockChart.tsx
git commit -m "Rewire chart for progressive reveal and bolder visuals"
```

---

### Task 4: Verify in the running app

**Files:** none modified — this task is observation.

- [ ] **Step 1: Regenerate a fixture with the new 12-quarter cap**

Run (substituting today's date):

```bash
npx tsx scripts/fetch-financials-data.ts 2026-08-12
```

Expected: `Generating 2026-08-12: <TICKER>` then `Wrote ...`. Confirm the payload carries 12 revenue points, not 28:

```bash
cat public/games/2026-08-12.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('revenue points:', len(d['revenueData'])); print('netIncomeTrend:', d.get('netIncomeTrend','ABSENT'))"
```

Expected: `revenue points: 12`. `netIncomeTrend` should still be present for most tickers (it's computed over 28 quarters — if it's ABSENT, that's this ticker genuinely lacking `NetIncomeLoss` data, which is legitimate; try another date to see a present one).

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 3: Drive the reveal in a browser**

Open `http://localhost:3000` and confirm, in order:
1. At 0 guesses: exactly **4 bold bars**, header reads "last 4 quarters", no x-axis labels anywhere.
2. Click **Skip** once → **6 bars**, header updates, new bars animate in from the baseline rather than snapping.
3. Skip again → 8 bars. Again → 10. Again → 12 (or "full history").
4. The rightmost bar never moves position across all reveals, and no bar changes color as others appear.
5. Hovering a bar before guess 3 shows **no tooltip**; after guess 3 it shows `$NNNNM`.

- [ ] **Step 4: Verify a legacy 28-entry fixture still renders**

The other file in `public/games/` was generated before this change and still carries 28 points. Temporarily point the app at it by changing your system date, or simpler — confirm directly that the reveal math handles it:

```bash
cat public/games/*.json | python3 -c "
import json,sys,glob
for f in glob.glob('public/games/2026-*.json'):
    if 'answer' in f: continue
    d = json.load(open(f))
    n = len(d['revenueData'])
    print(f, '->', n, 'points; visible at g0 =', min(4, 12, n), '; at g4 =', min(12, 12, n))
"
```

Expected: every file reports a sane visible count at both g0 and g4, whether it carries 12 or 28 points.

- [ ] **Step 5: Report observations**

Note anything that felt off — animation speed, whether 4 bars is too little to start from, whether the "last N quarters" copy reads well. These feed the two open questions in the design doc.

---

## Self-Review Notes (completed during plan authoring)

- **Spec coverage:** every section of the design doc maps to a task — §1 data/schema → Task 1, §2 progressive reveal → Task 2, §3 visual treatment → Task 3, §4 anonymization → preserved explicitly in Task 3's code with comments, Testing → Tasks 1–2, Migration → Task 4 Step 4.
- **Call-chain verified before writing:** `extractQuarterlySeries` is called from `fetchConceptWithFallback` (line 146), which is called twice in `pickPuzzleWithData` — once for revenue, once for net income. That's the exact path that made the shared constant a latent hint-changing bug, and the plan threads the cap through all three layers.
- **Type consistency checked:** `visibleQuarterCount`, `visibleSlice`, `barColorsForVisible`, `MAX_VISIBLE_QUARTERS`, `UP_COLOR`, `DOWN_COLOR` are defined once in Task 2 and imported with matching names/signatures in Task 3.
- **No placeholders:** every step has literal code or literal commands.
- **`page.tsx` deliberately untouched:** `StockChart`'s props don't change, so there's no call-site edit and no risk of prop drift.
