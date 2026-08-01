"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { RevenuePoint } from "@/types/game";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface StockChartProps {
  data: RevenuePoint[];
  guessCount: number;
}

export function StockChart({ data, guessCount }: StockChartProps) {
  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "bar",
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
        categories: data.map((d) => d.x),
        labels: {
          show: true,
          style: { colors: "#9ca3af", fontSize: "10px" },
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { show: false },
      },
      // Bar/column charts default dataLabels to visible, which would print the
      // real revenue value on every bar regardless of guess count — must be
      // explicitly disabled to preserve the same anonymization the old
      // candlestick chart relied on (hidden axis values until solved/hover).
      dataLabels: { enabled: false },
      legend: { show: false },
      tooltip: {
        // Exact revenue on hover is more revealing than the shape alone.
        enabled: guessCount >= 3,
        theme: "dark",
        y: {
          formatter: (val: number) => `$${(val / 1_000_000).toFixed(0)}M`,
        },
      },
      plotOptions: {
        bar: {
          // distributed: true is required for the per-bar `colors` array
          // below to apply — without it every bar uses colors[0] only.
          distributed: true,
          columnWidth: "70%",
        },
      },
      colors: data.map((d, i) => (i === 0 || d.y >= data[i - 1].y ? "#22c55e" : "#ef4444")),
    }),
    [guessCount, data]
  );

  const series = useMemo(() => [{ name: "Revenue", data: data.map((d) => d.y) }], [data]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-gray-900">
      <span className="absolute top-2 right-2 z-10 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">
        Quarterly Revenue
      </span>
      <ApexChart type="bar" series={series} options={options} height={260} width="100%" />
    </div>
  );
}
