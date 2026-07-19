import https from "https";
import fs from "fs/promises";
import path from "path";
import { TRIVIA_HINTS } from "../src/data/trivia-hints";

function fetchText(
  url: string,
  headers: Record<string, string> = { "User-Agent": "TickerGuessr/1.0 (pool builder)" },
  timeoutMs = 15_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, { headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs}ms: ${url}`)));
  });
}

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-/]/g, ".");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMarketCapTier(cap: number): string {
  if (cap >= 200_000_000_000) return "Mega Cap";
  if (cap >= 10_000_000_000) return "Large Cap";
  if (cap >= 2_000_000_000) return "Mid Cap";
  return "Small Cap";
}

// api.nasdaq.com's public (keyless, undocumented) quote-summary endpoint covers
// both NASDAQ- and NYSE-listed tickers. Falls back to "Large Cap" (the pool is
// curated S&P 500 / Nasdaq-100, i.e. already large/mega cap) if the lookup fails.
async function fetchMarketCapTier(ticker: string): Promise<string> {
  try {
    const raw = await fetchText(`https://api.nasdaq.com/api/quote/${ticker}/summary?assetclass=stocks`, {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    });
    const json = JSON.parse(raw);
    const capStr: string | undefined = json?.data?.summaryData?.MarketCap?.value;
    const cap = Number((capStr ?? "").replace(/,/g, ""));
    if (!Number.isFinite(cap) || cap <= 0) throw new Error(`no market cap for ${ticker}`);
    return getMarketCapTier(cap);
  } catch (err) {
    console.warn(`⚠️  Market cap lookup failed for ${ticker} (${(err as Error).message}); defaulting to "Large Cap".`);
    return "Large Cap";
  }
}

// Strip HTML tags/entities from a Wikipedia table cell.
function clean(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
}

interface PoolEntry { ticker: string; name: string; sector: string; marketCapTier: string; triviaHints: [string, string] }
type WikiEntry = Omit<PoolEntry, "marketCapTier" | "triviaHints">;

// Trivia isn't scraped (no reliable free API for it) — it's curated by hand into
// trivia-hints.ts via an LLM prompt. Falls back to a generic, non-placeholder pair
// so a newly-added constituent still ships real hint text until someone backfills it.
function triviaHintsFor(e: WikiEntry): [string, string] {
  const curated = TRIVIA_HINTS[e.ticker];
  if (curated) return curated;
  console.warn(`⚠️  No curated trivia for ${e.ticker}; using a generic fallback.`);
  return [
    `${e.name} operates in the ${e.sector} sector.`,
    `${e.name} is a constituent of the S&P 500 or Nasdaq-100 index.`,
  ];
}

// Parse wikitables on the page; scans all tables and uses the first one whose
// headers match the requested columns. This tolerates layout shifts that add
// new tables before the constituent table.
function parseWikiTable(
  html: string,
  cols: { ticker: string; name: string; sector: string }
): WikiEntry[] {
  const tableMatches = Array.from(html.matchAll(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/g));
  if (!tableMatches.length) throw new Error("no wikitable found");

  let lastHeaderSeen = "";
  for (const tableMatch of tableMatches) {
    const table = tableMatch[0];
    const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    if (!rows.length) continue;
    const header = ((rows[0] ?? "").match(/<th[\s\S]*?<\/th>/g) ?? []).map((h: string) => clean(h).toLowerCase());
    const idxOf = (label: string) => header.findIndex((h: string) => h.includes(label));
    const ti = idxOf(cols.ticker), ni = idxOf(cols.name), si = idxOf(cols.sector);
    lastHeaderSeen = header.join(" | ");
    if (ti < 0 || ni < 0 || si < 0) continue; // try next table

    const out: WikiEntry[] = [];
    for (const row of rows.slice(1)) {
      const cells = (row.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map(clean);
      if (cells.length <= Math.max(ti, ni, si)) continue;
      const ticker = normalizeTicker(cells[ti]);
      if (!/^[A-Z.]+$/.test(ticker)) continue;
      out.push({ ticker, name: cells[ni], sector: cells[si] || "Unknown" });
    }
    return out;
  }
  throw new Error(`header mismatch across all tables; last header seen: ${lastHeaderSeen}`);
}

async function main() {
  console.log("Fetching S&P 500 + Nasdaq-100 constituents...");
  const [sp, nd] = await Promise.all([
    fetchText("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"),
    fetchText("https://en.wikipedia.org/wiki/Nasdaq-100"),
  ]);

  const spEntries = parseWikiTable(sp, { ticker: "symbol", name: "security", sector: "gics sector" });
  const ndEntries = parseWikiTable(nd, { ticker: "ticker", name: "company", sector: "icb industry" });
  console.log(`S&P 500: ${spEntries.length}, Nasdaq-100: ${ndEntries.length}`);
  if (spEntries.length < 400) throw new Error("S&P 500 parse looks wrong (<400 rows)");
  if (ndEntries.length < 80) throw new Error("Nasdaq-100 parse looks wrong (<80 rows)");

  const map = new Map<string, WikiEntry>();
  // Dedupe by ticker. Insert Nasdaq-100 first, then S&P, so the ~80 overlap
  // tickers keep S&P's GICS sector; Nasdaq-100-only names retain ICB industry.
  for (const e of [...ndEntries, ...spEntries]) map.set(e.ticker, e);
  const wikiPool = Array.from(map.values()).sort((a, b) => a.ticker.localeCompare(b.ticker));
  console.log(`Pool (deduped): ${wikiPool.length} tickers`);

  console.log("Fetching market cap tiers (api.nasdaq.com, rate-limited)...");
  const pool: PoolEntry[] = [];
  for (const e of wikiPool) {
    const marketCapTier = await fetchMarketCapTier(e.ticker);
    pool.push({ ...e, marketCapTier, triviaHints: triviaHintsFor(e) });
    await sleep(150); // be polite to the undocumented endpoint
  }

  const output = [
    "// Generated by scripts/build-puzzle-pool.ts — do not edit manually.",
    "// Source: Wikipedia S&P 500 + Nasdaq-100 constituent tables. Recognizable large-caps.",
    "// Market cap tiers from api.nasdaq.com (undocumented, keyless).",
    "// Trivia hints curated by hand in src/data/trivia-hints.ts.",
    "// Re-run: npx tsx scripts/build-puzzle-pool.ts",
    "export interface PoolEntry {",
    "  ticker: string;",
    "  name: string;",
    "  sector: string;",
    "  marketCapTier: string;",
    "  triviaHints: [string, string];",
    "}",
    "",
    `export const PUZZLE_POOL: PoolEntry[] = ${JSON.stringify(pool, null, 2)};`,
  ].join("\n");

  await fs.writeFile(path.join(process.cwd(), "src/data/puzzle-pool.ts"), output + "\n");
  console.log(`Wrote ${pool.length} entries to src/data/puzzle-pool.ts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
