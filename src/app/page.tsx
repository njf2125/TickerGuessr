"use client";
import { useState, useEffect } from "react";
import { useGameState } from "@/hooks/useGameState";
import { Header } from "@/components/Header";
import { StockChart } from "@/components/StockChart";
import { HintContainer } from "@/components/HintContainer";

const TODAY = new Date().toLocaleDateString("en-CA");

export default function Home() {
  const { payload, guesses, isLoading, error, justFinished } =
    useGameState(TODAY);
  const [, setShowStats] = useState(false);

  // Auto-open stats only when the player just completed this session — not on refresh.
  useEffect(() => {
    if (justFinished) {
      const timer = setTimeout(() => setShowStats(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [justFinished]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 animate-pulse">Loading today&apos;s puzzle...</p>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-screen px-6 text-center">
        <p className="text-gray-300">
          Today&apos;s puzzle isn&apos;t available yet. A fresh chart drops every
          morning — please check back soon.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto">
      <Header onStatsClick={() => setShowStats(true)} />
      <main className="flex flex-col flex-1 gap-3 p-3">
        <StockChart
          data={payload.candlestickData}
          interval={payload.interval}
          guessCount={guesses.length}
        />
        <HintContainer
          sector={payload.sector}
          marketCapTier={payload.marketCapTier}
          triviaHints={payload.triviaHints}
          firstLetter={payload.ticker[0]}
          guessCount={guesses.length}
        />
      </main>
    </div>
  );
}
