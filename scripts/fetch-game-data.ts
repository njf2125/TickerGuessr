import https from "https";
import fs from "fs/promises";
import path from "path";
import {
  selectPuzzle,
  gameIdFor,
} from "../src/data/puzzle-selection";
import type { GameDayAnswer, GameDayPayload, OHLCPoint, CandleInterval } from "../src/types/game";

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
export function assertNotThrottled(res: Record<string, unknown>): void {
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
    if (!f.endsWith(".json") || f.includes("-answer")) continue;
    const d = new Date(f.replace(".json", "")).getTime();
    if (isNaN(d)) continue;
    if (d < target && target - d <= windowMs) {
      try {
        // Read from the answer file (new split format); fall back to main file (legacy).
        const answerPath = path.join(gamesDir, f.replace(".json", "-answer.json"));
        let ticker: string | undefined;
        try {
          const answer = JSON.parse(await fs.readFile(answerPath, "utf8"));
          ticker = answer?.ticker;
        } catch {
          const payload = JSON.parse(await fs.readFile(path.join(gamesDir, f), "utf8"));
          ticker = payload?.ticker;
        }
        if (ticker) used.add(ticker);
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
  const rawCap = overview["MarketCapitalization"];
  const marketCap = Number(rawCap);
  let marketCapTier: string;
  if (!Number.isFinite(marketCap) || marketCap <= 0) {
    console.warn(`⚠️  No usable market cap for ${puzzle.ticker} (got ${JSON.stringify(rawCap)}); defaulting tier to "Large Cap" (answer pool is all large/mega cap).`);
    marketCapTier = "Large Cap";
  } else {
    marketCapTier = getMarketCapTier(marketCap);
  }

  const payload: GameDayPayload = {
    gameId: gameIdFor(dateString),
    dateString,
    firstLetter: puzzle.ticker[0],
    interval: puzzle.interval,
    sector: puzzle.sector,
    marketCapTier,
    triviaHints: ["TODO: trivia hint 1", "TODO: trivia hint 2"],
    candlestickData,
  };

  const answer: GameDayAnswer = {
    ticker: puzzle.ticker,
    companyName: puzzle.name,
  };

  await fs.mkdir(gamesDir, { recursive: true });
  const outPath = path.join(gamesDir, `${dateString}.json`);
  const answerPath = path.join(gamesDir, `${dateString}-answer.json`);
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
  await fs.writeFile(answerPath, JSON.stringify(answer, null, 2) + "\n");
  console.log(`Wrote ${outPath} + ${answerPath}`);
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

// Run main() only when this file is the directly-invoked script (e.g. `npx tsx
// scripts/fetch-game-data.ts`), not when imported by the test file. Match the
// resolved basename exactly rather than a loose substring, so a wrapper script
// whose path merely contains "fetch-game-data" can't trigger it.
if (process.argv[1] && path.basename(process.argv[1]) === "fetch-game-data.ts") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
