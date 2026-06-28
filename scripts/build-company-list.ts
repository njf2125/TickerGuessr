import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
import https from "https";
import fs from "fs/promises";
import path from "path";

const MARKET_CAP_MIN = 2_000_000_000;
const AVG_VOLUME_MIN = 300_000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1500;

// The app + game-schedule use dot notation for share classes (BRK.B); the
// NASDAQ/Yahoo sources are inconsistent (dash, slash). Normalize every parsed
// ticker to the dot convention so companies.ts always matches the schedule and
// what the player types from the autocomplete.
function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-/]/g, ".");
}

// Yahoo wants dash notation (BRK-B). Mirror of toYahooSymbol() in
// fetch-game-data.ts — convert before any Yahoo call, then map results back by
// the dot-notation ticker so the saved company keeps the app's dot form.
function toYahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

async function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function parseNasdaqListed(text: string): Array<{ ticker: string; name: string }> {
  return text
    .trim()
    .split("\n")
    .slice(1) // skip header
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
    .slice(1) // skip header
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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function filterByMarketCapAndVolume(
  companies: Array<{ ticker: string; name: string }>
): Promise<Array<{ ticker: string; name: string }>> {
  const results: Array<{ ticker: string; name: string }> = [];

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    process.stdout.write(`\rFiltering ${i}/${companies.length}...`);

    // Map Yahoo's dash-notation symbol back to our dot-notation company.
    const byYahooSymbol = new Map(batch.map((c) => [toYahooSymbol(c.ticker), c]));

    try {
      const quotes = await yahooFinance.quote(batch.map((c) => toYahooSymbol(c.ticker)));
      const quotesArray = Array.isArray(quotes) ? quotes : [quotes];

      for (const quote of quotesArray) {
        const marketCap = quote.marketCap ?? 0;
        const avgVolume = quote.averageDailyVolume3Month ?? 0;

        if (marketCap >= MARKET_CAP_MIN && avgVolume >= AVG_VOLUME_MIN) {
          const company = byYahooSymbol.get(quote.symbol ?? "");
          if (company) results.push(company);
        }
      }
    } catch {
      // Skip failed batch — Yahoo Finance occasionally 429s
    }

    await sleep(BATCH_DELAY_MS);
  }

  process.stdout.write("\n");
  return results;
}

async function main() {
  console.log("Fetching NASDAQ listed symbols...");
  const nasdaqText = await fetchText(
    "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
  );
  const nasdaqCompanies = parseNasdaqListed(nasdaqText);
  console.log(`NASDAQ: ${nasdaqCompanies.length} common stocks`);

  console.log("Fetching NYSE/other listed symbols...");
  const otherText = await fetchText(
    "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
  );
  const otherCompanies = parseOtherListed(otherText);
  console.log(`NYSE/Other: ${otherCompanies.length} common stocks`);

  // Deduplicate by ticker, NASDAQ names take precedence
  const allMap = new Map<string, string>();
  for (const c of [...otherCompanies, ...nasdaqCompanies]) {
    allMap.set(c.ticker, c.name);
  }
  const all = Array.from(allMap.entries()).map(([ticker, name]) => ({ ticker, name }));
  console.log(`Total unique symbols: ${all.length}`);

  console.log(`Filtering (market cap ≥ $2B, avg volume ≥ 300k) — takes ~20 min...`);
  const filtered = await filterByMarketCapAndVolume(all);
  filtered.sort((a, b) => a.ticker.localeCompare(b.ticker));
  console.log(`After filtering: ${filtered.length} companies`);

  const output = [
    'import { Company } from "@/types/game";',
    "",
    "// Generated by scripts/build-company-list.ts — do not edit manually.",
    `// Filters: market cap >= $2B, avg daily volume >= 300k, NASDAQ + NYSE common stock.`,
    `// Re-run quarterly: npx tsx scripts/build-company-list.ts`,
    `export const COMPANIES: Company[] = ${JSON.stringify(filtered, null, 2)};`,
  ].join("\n");

  const outPath = path.join(process.cwd(), "src/data/companies.ts");
  await fs.writeFile(outPath, output);
  console.log(`Wrote ${filtered.length} companies to src/data/companies.ts`);
  console.log("Do a manual pass to remove any remaining obscure or delisted entries.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
