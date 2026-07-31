import https from "https";
import fs from "fs/promises";
import path from "path";
import { TRIVIA_HINTS } from "../src/data/trivia-hints";
import { PUZZLE_POOL as PREVIOUS_POOL } from "../src/data/puzzle-pool";

// Wikimedia's bot policy requires a descriptive User-Agent identifying the tool
// and a contact URL: https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
const WIKI_USER_AGENT = "TickerGuessrBot/1.0 (https://tickerguessr.app)";

function fetchText(
  url: string,
  headers: Record<string, string> = { "User-Agent": WIKI_USER_AGENT },
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

// Fetch a Wikipedia article's parsed HTML via the official Action API (action=parse)
// rather than scraping the rendered page directly.
async function fetchWikiPageHtml(title: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(
    title
  )}&prop=text&format=json&formatversion=2`;
  const raw = await fetchText(url);
  const json = JSON.parse(raw);
  if (json.error) throw new Error(`Wikipedia API error for "${title}": ${json.error.info}`);
  return json.parse.text as string;
}

function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-/]/g, ".");
}

// api.nasdaq.com's undocumented quote-summary endpoint used to supply this, but
// that's fragile, unlicensed scraping. There's no live price feed to compute a
// real market cap from (the daily OHLC pipeline is currently paused — see
// CLAUDE.md), so tiers are carried forward from the previous pool build; a
// ticker new to the pool defaults to "Large Cap" since S&P 500 / Nasdaq-100
// membership already implies large/mega cap.
const PREVIOUS_TIERS = new Map(PREVIOUS_POOL.map((e) => [e.ticker, e.marketCapTier]));
function marketCapTierFor(ticker: string): string {
  return PREVIOUS_TIERS.get(ticker) ?? "Large Cap";
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
  console.log("Fetching S&P 500 + Nasdaq-100 constituents (Wikipedia Action API)...");
  const [sp, nd] = await Promise.all([
    fetchWikiPageHtml("List of S&P 500 companies"),
    fetchWikiPageHtml("List of NASDAQ-100 companies"),
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

  const pool: PoolEntry[] = wikiPool.map((e) => ({
    ...e,
    marketCapTier: marketCapTierFor(e.ticker),
    triviaHints: triviaHintsFor(e),
  }));

  const output = [
    "// Generated by scripts/build-puzzle-pool.ts — do not edit manually.",
    "// Source: Wikipedia S&P 500 + Nasdaq-100 constituent tables (via Action API). Recognizable large-caps.",
    "// Market cap tiers carried forward from the previous build; new tickers default to Large Cap.",
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
