"use client";
import { useState, useEffect, useCallback } from "react";
import {
  GameDayPayload,
  GuessResult,
  PlayerStats,
  PersistedGameState,
  GameStatus,
} from "@/types/game";
import { COMPANIES } from "@/data/companies";
import { DEFAULT_STATS, computeNextStats } from "@/lib/stats";

const STATS_KEY = "tickerguessr_stats";
const GAME_KEY = (date: string) => `tickerguessr_game_${date}`;

function loadStats(): PlayerStats {
  if (typeof window === "undefined") return DEFAULT_STATS;
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? (JSON.parse(raw) as PlayerStats) : DEFAULT_STATS;
  } catch {
    return DEFAULT_STATS;
  }
}

function saveStats(stats: PlayerStats): void {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function loadGameState(date: string): PersistedGameState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(GAME_KEY(date));
    return raw ? (JSON.parse(raw) as PersistedGameState) : null;
  } catch {
    return null;
  }
}

function saveGameState(state: PersistedGameState): void {
  localStorage.setItem(GAME_KEY(state.dateString), JSON.stringify(state));
}

export function useGameState(dateString: string) {
  const [payload, setPayload] = useState<GameDayPayload | null>(null);
  const [guesses, setGuesses] = useState<GuessResult[]>([]);
  const [status, setStatus] = useState<GameStatus>("playing");
  const [stats, setStats] = useState<PlayerStats>(DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Never true on initial load — only true when submitGuess causes a terminal transition.
  const [justFinished, setJustFinished] = useState(false);

  useEffect(() => {
    const persisted = loadGameState(dateString);
    const storedStats = loadStats();
    setStats(storedStats);

    fetch(`/games/${dateString}.json`)
      .then((res) => {
        if (!res.ok) throw new Error("Game not found for this date.");
        return res.json() as Promise<GameDayPayload>;
      })
      .then((data) => {
        setPayload(data);
        if (persisted && persisted.dateString === dateString) {
          setGuesses(persisted.guesses);
          setStatus(persisted.status);
          // justFinished stays false — this is a resumed session, not a fresh completion
        }
        setIsLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, [dateString]);

  const submitGuess = useCallback(
    (ticker: string) => {
      if (!payload || status !== "playing") return;

      const upperTicker = ticker.toUpperCase();
      // Ignore duplicate guesses — a repeat must not burn an attempt.
      if (guesses.some((g) => g.ticker === upperTicker)) return;

      const company = COMPANIES.find((c) => c.ticker === upperTicker);
      const isCorrect = upperTicker === payload.ticker;

      const result: GuessResult = {
        ticker: upperTicker,
        name: company?.name ?? upperTicker,
        isCorrect,
      };

      const nextGuesses = [...guesses, result];
      let nextStatus: GameStatus = "playing";

      if (isCorrect) {
        nextStatus = "won";
      } else if (nextGuesses.length >= 6) {
        nextStatus = "lost";
      }

      setGuesses(nextGuesses);
      setStatus(nextStatus);

      if (nextStatus !== "playing") {
        setJustFinished(true);
      }

      saveGameState({ dateString, guesses: nextGuesses, status: nextStatus });

      if (nextStatus !== "playing") {
        const prevStats = loadStats();
        const nextStats = computeNextStats(
          prevStats,
          nextStatus === "won",
          nextGuesses.length
        );
        setStats(nextStats);
        saveStats(nextStats);
      }
    },
    [payload, status, guesses, dateString]
  );

  return { payload, guesses, status, stats, isLoading, error, justFinished, submitGuess };
}
