"use client";
import { BarChart2 } from "lucide-react";

interface HeaderProps {
  onStatsClick: () => void;
}

export function Header({ onStatsClick }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
      <div className="w-8" />
      <h1 className="text-lg font-bold tracking-widest uppercase text-white">
        TickerGuessr
      </h1>
      <button
        onClick={onStatsClick}
        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
        aria-label="View statistics"
      >
        <BarChart2 size={20} />
      </button>
    </header>
  );
}
