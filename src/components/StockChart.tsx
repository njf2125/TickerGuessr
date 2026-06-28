"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { OHLCPoint, CandleInterval } from "@/types/game";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

const INTERVAL_LABELS: Record<CandleInterval, string> = {
  "1h": "Hourly",
  "1d": "Daily",
  "1w": "Weekly",
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
        show: guessCount >= 1,
        borderColor: "#374151",
      },
      xaxis: {
        labels: {
          show: guessCount >= 3,
          style: { colors: "#9ca3af", fontSize: "10px" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        labels: {
          show: guessCount >= 4,
          style: { colors: "#9ca3af", fontSize: "10px" },
          formatter: (val: number) => `$${val.toFixed(0)}`,
        },
      },
      tooltip: {
        // Candlestick tooltips reveal exact OHLC prices, so keep them gated to
        // the same threshold as the Y-axis ($ scale) reveal — no early price leak.
        enabled: guessCount >= 4,
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
    [guessCount]
  );

  const series = useMemo(
    () => [{ data: data.map((d) => ({ x: d.x, y: d.y })) }],
    [data]
  );

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-gray-900">
      {guessCount >= 1 && (
        <span className="absolute top-2 right-2 z-10 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
          {INTERVAL_LABELS[interval]}
        </span>
      )}
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
