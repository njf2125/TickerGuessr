"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { OHLCPoint, CandleInterval } from "@/types/game";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const INTERVAL_LABELS: Record<CandleInterval, string> = {
  "1d": "Daily",
  "1w": "Weekly",
  "1mo": "Monthly",
};

interface StockChartProps {
  data: OHLCPoint[];
  interval: CandleInterval;
  guessCount: number;
}

export function StockChart({ data, interval, guessCount }: StockChartProps) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "candlestick",
        background: "transparent",
        toolbar: { show: false },
        animations: { enabled: false },
      },
      theme: { mode: "dark" },
      grid: {
        show: true,
        borderColor: "#374151",
      },
      xaxis: {
        type: "datetime",
        tickAmount: 6,
        labels: {
          show: true,
          style: { colors: "#9ca3af", fontSize: "10px" },
          // Coarse on purpose: month for daily/weekly charts, year for monthly.
          // d.x is already a synthetic, seeded calendar (see fakeDateSeries in
          // fetch-game-data.ts) — no real trading date reaches the client.
          formatter: (value: string) => {
            const d = new Date(Number(value));
            return interval === "1mo"
              ? `${d.getUTCFullYear()}`
              : d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
          },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        labels: {
          show: true,
          style: { colors: "#9ca3af", fontSize: "10px" },
          formatter: (val: number) => `$${val.toFixed(0)}`,
        },
      },
      tooltip: {
        // Exact OHLC on hover is more revealing than the price scale alone.
        enabled: guessCount >= 3,
        theme: "dark",
      },
      plotOptions: {
        candlestick: {
          colors: {
            upward: "#22c55e",
            downward: "#ef4444",
          },
          wick: { useFillColor: true },
        },
      },
    }),
    [guessCount, interval]
  );

  const series = useMemo(
    () => [{ data: data.map((d) => ({ x: new Date(d.x).getTime(), y: d.y })) }],
    [data]
  );

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-gray-900">
      <span className="absolute top-2 right-2 z-10 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
        {INTERVAL_LABELS[interval]}
      </span>
      <ApexChart
        type="candlestick"
        series={series}
        options={options}
        height={260}
        width="100%"
      />
    </div>
  );
}
