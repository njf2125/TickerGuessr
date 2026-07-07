import https from "https";
import fs from "fs/promises";
import path from "path";
import {
  selectPuzzle,
  gameIdFor,
} from "../src/data/puzzle-selection";
import type { GameDayAnswer, GameDayPayload, OHLCPoint, CandleInterval } from "../src/types/game";

const API_KEY = process.env.TWELVEDATA_API_KEY;
const BASE = "https://api.twelvedata.com";
const HISTORY_WINDOW_DAYS = 180;

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

// Twelve Data signals errors via {"status": "error", "message": ...} (with HTTP 200 in some cases).
export function assertNotThrottled(res: Record<string, unknown>): void {
  if (res["status"] === "error") throw new Error(`Twelve Data: ${String(res["message"])}`);
}

type TDSeries = { datetime: string; open: string; high: string; low: string; close: string }[];

// x is the real bar date (YYYY-MM-DD) so the chart's x-axis can render actual
// months/years — coarse enough to not give away the exact day, but real
// enough for the axis to read like a normal stock chart.
export function parseSeries(series: TDSeries, count: number): OHLCPoint[] {
  if (series.length === 0) throw new Error("empty Twelve Data series (throttled or bad symbol?)");
  const oldestFirst = [...series] // Twelve Data returns newest-first
    .sort((a, b) => a.datetime.localeCompare(b.datetime))
    .slice(-count);
  return oldestFirst.map((ohlc) => ({
    x: ohlc.datetime,
    y: [
      Math.round(Number(ohlc.open) * 100) / 100,
      Math.round(Number(ohlc.high) * 100) / 100,
      Math.round(Number(ohlc.low) * 100) / 100,
      Math.round(Number(ohlc.close) * 100) / 100,
    ],
  }));
}

function twelveDataInterval(interval: CandleInterval): string {
  if (interval === "1w") return "1week";
  if (interval === "1mo") return "1month";
  return "1day";
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
  if (!API_KEY) throw new Error("TWELVEDATA_API_KEY is not set");
  const gamesDir = path.join(process.cwd(), "public", "games");
  const recent = await recentlyUsedTickers(dateString, gamesDir);
  const puzzle = selectPuzzle(dateString, recent);
  console.log(`Generating ${dateString}: ${puzzle.ticker} (${puzzle.interval})`);

  const interval = twelveDataInterval(puzzle.interval);
  const priceRes = await getJson(
    `${BASE}/time_series?symbol=${puzzle.ticker}&interval=${interval}&outputsize=30&apikey=${API_KEY}`
  );
  assertNotThrottled(priceRes);
  const series = priceRes["values"] as TDSeries | undefined;
  if (!series) throw new Error(`missing "values" in Twelve Data response for ${puzzle.ticker}`);
  const candlestickData = parseSeries(series, 30);
  if (candlestickData.length < 10) {
    throw new Error(`only ${candlestickData.length} bars for ${puzzle.ticker}`);
  }

  const payload: GameDayPayload = {
    gameId: gameIdFor(dateString),
    dateString,
    firstLetter: puzzle.ticker[0],
    interval: puzzle.interval,
    sector: puzzle.sector,
    marketCapTier: puzzle.marketCapTier,
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
