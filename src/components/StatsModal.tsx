"use client";
import { useCallback, useEffect, useState } from "react";
import { PlayerStats, GuessResult, GameStatus } from "@/types/game";
import { buildShareText } from "@/lib/share";

interface StatsModalProps {
  stats: PlayerStats;
  guesses: GuessResult[];
  status: GameStatus;
  gameId: number;
  onClose: () => void;
}

export function StatsModal({ stats, guesses, status, gameId, onClose }: StatsModalProps) {
  const [copied, setCopied] = useState(false);

  // Close on Escape — matches the backdrop-tap affordance below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleShare = useCallback(async () => {
    const text = buildShareText(guesses, status, gameId);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [guesses, status, gameId]);

  const winRate =
    stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
      : 0;

  const maxDist = Math.max(...stats.guessDistribution, 1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-widest uppercase">Statistics</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { value: stats.gamesPlayed, label: "Played" },
            { value: `${winRate}%`, label: "Win %" },
            { value: stats.currentStreak, label: "Streak" },
            { value: stats.maxStreak, label: "Best" },
          ].map(({ value, label }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-2xl font-bold">{value}</span>
              <span className="text-xs text-gray-400 leading-tight">{label}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase text-gray-400 tracking-wider">
            Guess Distribution
          </p>
          {stats.guessDistribution.map((count, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="w-3 text-gray-400">{i + 1}</span>
              <div className="flex-1 bg-gray-800 rounded-sm h-5 overflow-hidden">
                <div
                  className="h-full bg-green-600 rounded-sm flex items-center justify-end pr-1.5 text-white text-xs font-medium transition-all"
                  style={{
                    width: `${(count / maxDist) * 100}%`,
                    minWidth: count > 0 ? "1.5rem" : 0,
                  }}
                >
                  {count > 0 ? count : ""}
                </div>
              </div>
            </div>
          ))}
        </div>

        {(status === "won" || status === "lost") && (
          <button
            onClick={handleShare}
            className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors"
          >
            {copied ? "Copied! ✓" : "Share Results"}
          </button>
        )}
      </div>
    </div>
  );
}
