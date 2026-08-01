import https from "https";

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
