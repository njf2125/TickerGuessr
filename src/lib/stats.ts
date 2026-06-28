import { PlayerStats } from "@/types/game";

export const DEFAULT_STATS: PlayerStats = {
  gamesPlayed: 0,
  gamesWon: 0,
  currentStreak: 0,
  maxStreak: 0,
  guessDistribution: [0, 0, 0, 0, 0, 0],
};

// Pure reducer: given the previous stats and the outcome of a finished game,
// returns the next stats. Never mutates `prev`. attemptCount is the number of
// guesses used (1–6); only wins update the distribution.
export function computeNextStats(
  prev: PlayerStats,
  won: boolean,
  attemptCount: number
): PlayerStats {
  const newStreak = won ? prev.currentStreak + 1 : 0;
  const guessDistribution = [
    ...prev.guessDistribution,
  ] as PlayerStats["guessDistribution"];
  if (won && attemptCount >= 1 && attemptCount <= 6) {
    guessDistribution[attemptCount - 1] += 1;
  }
  return {
    gamesPlayed: prev.gamesPlayed + 1,
    gamesWon: prev.gamesWon + (won ? 1 : 0),
    currentStreak: newStreak,
    maxStreak: Math.max(prev.maxStreak, newStreak),
    guessDistribution,
  };
}
