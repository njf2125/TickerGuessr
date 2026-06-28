"use client";
import { useState, useEffect } from "react";
import { useGameState } from "@/hooks/useGameState";
import { Header } from "@/components/Header";
import { StockChart } from "@/components/StockChart";
import { HintContainer } from "@/components/HintContainer";
import { AttemptMatrix } from "@/components/AttemptMatrix";
import { SearchInput } from "@/components/SearchInput";
import { StatsModal } from "@/components/StatsModal";
import { HowToModal } from "@/components/HowToModal";

const TODAY = new Date().toLocaleDateString("en-CA");

export default function Home() {
  const { payload, guesses, status, stats, isLoading, error, justFinished, submitGuess } =
    useGameState(TODAY);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Auto-open stats only when the player just completed this session — not on refresh.
  useEffect(() => {
    if (justFinished) {
      const timer = setTimeout(() => setShowStats(true), 1200);
      return () => clearTimeout(timer);
    }
  }, [justFinished]);

  // Auto-open the how-to once per browser, on first ever visit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("tickerguessr_seen_intro")) {
      setShowHelp(true);
      localStorage.setItem("tickerguessr_seen_intro", "1");
    }
  }, []);

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
      <Header onStatsClick={() => setShowStats(true)} onHelpClick={() => setShowHelp(true)} />
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
        <AttemptMatrix guesses={guesses} />
        {status !== "playing" && (
          <div className="rounded-xl border border-gray-700 bg-gray-800/60 px-4 py-3 text-center">
            <p className="text-xs uppercase tracking-wider text-gray-400">
              {status === "won" ? "You got it" : "The answer was"}
            </p>
            <p className="mt-1 text-lg font-bold">
              <span className="font-mono">{payload.ticker}</span>
              <span className="ml-2 font-normal text-gray-300">{payload.companyName}</span>
            </p>
          </div>
        )}
        <div className="mt-auto pt-2">
          <SearchInput
            onSubmit={submitGuess}
            disabled={status !== "playing"}
            guessedTickers={guesses.map((g) => g.ticker)}
          />
        </div>
      </main>
      {showStats && (
        <StatsModal
          stats={stats}
          guesses={guesses}
          status={status}
          gameId={payload.gameId}
          onClose={() => setShowStats(false)}
        />
      )}
      {showHelp && <HowToModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
