"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { RevenuePoint } from "@/types/game";
import {
  visibleQuarterCount,
  visibleSlice,
  barColorsForVisible,
} from "./chart-reveal";

const ApexChart = dynamic(() => import("react-apexcharts"), { ssr: false });

interface StockChartProps {
  data: RevenuePoint[];
  guessCount: number;
}

export function StockChart({ data, guessCount }: StockChartProps) {
  const visibleCount = visibleQuarterCount(guessCount, data.length);
  const visible = useMemo(() => visibleSlice(data, visibleCount), [data, visibleCount]);
  const colors = useMemo(() => barColorsForVisible(data, visibleCount), [data, visibleCount]);
  const isFullyRevealed = visibleCount >= data.length;

  const options: ApexOptions = useMemo(
    () => ({
      chart: {
        type: "bar",
        background: "transparent",
        toolbar: { show: false },
        // Animations are ON so newly revealed quarters grow in rather than
        // silently appearing — the reveal is the reward, it needs to be felt.
        animations: { enabled: true, speed: 400 },
      },
      theme: { mode: "dark" },
      grid: {
        show: true,
        borderColor: "#1f2937",
        padding: { left: 4, right: 4 },
      },
      xaxis: {
        categories: visible.map((d) => d.x),
        // Labels are deliberately hidden: the x values are synthetic sequential
        // placeholders (real filing dates are withheld for anonymization), so
        // rendering them was pure visual noise at any density.
        labels: { show: false },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: {
        labels: { show: false },
      },
      // Bar charts default dataLabels to visible, which would print the real
      // revenue value on every bar regardless of guess count — must stay off to
      // preserve anonymization until the tooltip unlocks at guess 3.
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
          // distributed: true is required for the per-bar `colors` array below to
          // apply — without it every bar uses colors[0] only.
          distributed: true,
          columnWidth: "62%",
          borderRadius: 4,
          borderRadiusApplication: "end",
        },
      },
      states: {
        hover: { filter: { type: "lighten", value: 0.08 } },
        active: { filter: { type: "none" } },
      },
      colors,
    }),
    [guessCount, visible, colors]
  );

  const series = useMemo(
    () => [{ name: "Revenue", data: visible.map((d) => d.y) }],
    [visible]
  );

  return (
    <div className="w-full rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Quarterly Revenue
        </span>
        <span className="text-[11px] text-gray-500 tabular-nums">
          {isFullyRevealed ? "full history" : `last ${visibleCount} quarters`}
        </span>
      </div>
      <ApexChart type="bar" series={series} options={options} height={300} width="100%" />
    </div>
  );
}
