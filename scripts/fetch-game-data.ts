import YahooFinance from "yahoo-finance2";
import fs from "fs/promises";
import path from "path";
import { getScheduleEntry, GAME_START_DATE } from "../src/data/game-schedule";
import type { GameDayPayload, OHLCPoint, CandleInterval } from "../src/types/game";

const yahooFinance = new YahooFinance();

const SECTOR_MAP: Record<string, string> = {
  Technology: "Technology",
  "Financial Services": "Financials",
  Healthcare: "Healthcare",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  Energy: "Energy",
  Industrials: "Industrials",
  "Basic Materials": "Materials",
  "Real Estate": "Real Estate",
  Utilities: "Utilities",
  "Communication Services": "Communication Services",
};

function getMarketCapTier(cap: number): string {
  if (cap >= 200_000_000_000) return "Mega Cap";
  if (cap >= 10_000_000_000) return "Large Cap";
  if (cap >= 2_000_000_000) return "Mid Cap";
  return "Small Cap";
}

function barLabel(index: number, interval: CandleInterval): string {
  return interval === "1w" ? `Wk ${index + 1}` : `Day ${index + 1}`;
}

// Yahoo uses dash notation for share classes (BRK-B); the app + companies.ts
// use dot notation (BRK.B). Convert before any Yahoo call; keep the dot form in
// the payload so it matches what the player can type from the autocomplete.
export function toYahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, "-");
}

async function generateGameFile(dateString: string): Promise<void> {
  // getScheduleEntry never returns null — it falls back deterministically.
  const entry = getScheduleEntry(dateString);
  const { ticker, interval } = entry;
  const yahooSymbol = toYahooSymbol(ticker);
  console.log(`Generating ${dateString}: ${ticker} (${interval})`);

  const summary = await yahooFinance.quoteSummary(yahooSymbol, {
    modules: ["summaryProfile", "price"],
  });

  const sector = SECTOR_MAP[summary.summaryProfile?.sector ?? ""] ?? "Unknown";
  const marketCap = summary.price?.marketCap ?? 0;
  const companyName =
    summary.price?.longName ?? summary.price?.shortName ?? ticker;

  // Fetch enough history to get 30 clean bars
  const endDate = new Date(dateString);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (interval === "1w" ? 240 : 50));

  // Use chart() — historical() is deprecated in yahoo-finance2 and emits a
  // deprecation notice. chart() returns { quotes: [{ date, open, high, low,
  // close, volume, adjclose }], ... }.
  const yahooInterval = interval === "1w" ? "1wk" : "1d";
  const chartResult = await yahooFinance.chart(yahooSymbol, {
    period1: startDate.toISOString().split("T")[0],
    period2: endDate.toISOString().split("T")[0],
    interval: yahooInterval,
  });

  // Drop any bar with a null OHLC value (Yahoo occasionally returns gaps).
  const quotes = chartResult.quotes.filter(
    (q) => q.open != null && q.high != null && q.low != null && q.close != null
  );
  const bars = quotes.slice(-30);
  if (bars.length < 10) {
    throw new Error(`Only ${bars.length} bars for ${ticker} — check date or ticker`);
  }

  const candlestickData: OHLCPoint[] = bars.map((bar, i) => ({
    x: barLabel(i, interval),
    y: [
      Math.round(Number(bar.open) * 100) / 100,
      Math.round(Number(bar.high) * 100) / 100,
      Math.round(Number(bar.low) * 100) / 100,
      Math.round(Number(bar.close) * 100) / 100,
    ],
  }));

  const start = new Date(GAME_START_DATE);
  const target = new Date(dateString);
  const gameId =
    Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const payload: GameDayPayload = {
    gameId,
    dateString,
    ticker,
    companyName,
    interval,
    sector,
    marketCapTier: getMarketCapTier(marketCap),
    triviaHints: [
      `TODO: trivia hint 1 for ${ticker}`,
      `TODO: trivia hint 2 for ${ticker}`,
    ],
    candlestickData,
  };

  const outPath = path.join(process.cwd(), "public", "games", `${dateString}.json`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);
  console.log(`⚠️  Fill in triviaHints for ${ticker} before ${dateString} goes live.`);
}

// Usage: npx tsx scripts/fetch-game-data.ts [YYYY-MM-DD]
// Defaults to tomorrow's date.
async function main() {
  const dateArg = process.argv[2];
  let targetDate: string;

  if (dateArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      console.error("Usage: npx tsx scripts/fetch-game-data.ts [YYYY-MM-DD]");
      process.exit(1);
    }
    targetDate = dateArg;
  } else {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    targetDate = tomorrow.toISOString().split("T")[0];
  }

  await generateGameFile(targetDate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
