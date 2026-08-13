import https from "https";
import fs from "fs/promises";
import path from "path";
import { selectPuzzle, SelectedPuzzle, gameIdFor } from "../src/data/puzzle-selection";
import type { GameDayPayload, GameDayAnswer, RevenuePoint } from "../src/types/game";

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

// SEC sometimes reports the very same real quarter with slightly different
// boundary dates across filings (verified live: Coca-Cola's Q3 2010 revenue
// appears twice — once as start "2010-07-02", once as "2010-07-03", same end
// date, same value, filed at different times). Keying strictly on the exact
// (start,end) string pair misses this, so cluster by end-date proximity
// instead: entries whose end dates fall within DEDUP_PROXIMITY_DAYS of each
// other are treated as the same period, keeping the most-recently-filed one.
// Real distinct quarters are ~90 days apart, far outside this threshold.
const DEDUP_PROXIMITY_DAYS = 15;

export function dedupeByPeriod(units: SecFactUnit[]): SecFactUnit[] {
  const sorted = [...units].sort((a, b) => a.end.localeCompare(b.end));
  const clusters: SecFactUnit[][] = [];
  for (const u of sorted) {
    const lastCluster = clusters[clusters.length - 1];
    const lastEnd = lastCluster ? new Date(lastCluster[lastCluster.length - 1].end).getTime() : null;
    const gapDays = lastEnd === null ? Infinity : (new Date(u.end).getTime() - lastEnd) / (1000 * 60 * 60 * 24);
    if (gapDays <= DEDUP_PROXIMITY_DAYS) {
      lastCluster!.push(u);
    } else {
      clusters.push([u]);
    }
  }
  return clusters.map((cluster) =>
    cluster.reduce((best, cur) => (new Date(cur.filed).getTime() > new Date(best.filed).getTime() ? cur : best))
  );
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
  // Upsert by date rather than blindly pushing — re-running for an
  // already-recorded date (backfill, accidental re-dispatch) replaces that
  // date's entry instead of accumulating duplicates.
  const withoutDate = history.filter((h) => h.date !== entry.date);
  withoutDate.push(entry);
  await fs.writeFile(TICKER_HISTORY_PATH, JSON.stringify(withoutDate, null, 2) + "\n");
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

const DAY_MS = 86_400_000;

// Which puzzle dates survive a prune. Yesterday is retained on purpose: these
// filenames are UTC dates, but the client asks for its LOCAL date
// (`toLocaleDateString("en-CA")` in src/app/page.tsx). Any timezone west of UTC
// is up to a day behind UTC, so between this prune and that user's local
// midnight they would request a date that had just been deleted and get a 404
// instead of a puzzle — roughly an hour nightly at UTC-7, four at UTC-10.
// Keeping one extra day of public-domain SEC-derived JSON covers every timezone.
export function retentionKeepDates(dateString: string, nowMs: number): Set<string> {
  const utcDay = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString().slice(0, 10);
  return new Set([utcDay(-DAY_MS), utcDay(0), utcDay(DAY_MS), dateString]);
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
  // Never fabricate a trend the data doesn't support — omit the field
  // entirely (JSON.stringify drops undefined properties) rather than
  // defaulting to a value with no real signal behind it.
  const netIncomeTrend: "up" | "down" | undefined = netIncome
    ? trendDirection(netIncome.map((u) => u.val))
    : undefined;

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

  await pruneOldPublicFiles(gamesDir, retentionKeepDates(dateString, Date.now()));

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
