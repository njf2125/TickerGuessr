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
