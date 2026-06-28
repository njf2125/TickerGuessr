import { describe, it, expect } from "vitest";
import { computeNextStats, DEFAULT_STATS } from "./stats";

describe("computeNextStats", () => {
  it("records a win on the 3rd attempt", () => {
    const next = computeNextStats(DEFAULT_STATS, true, 3);
    expect(next.gamesPlayed).toBe(1);
    expect(next.gamesWon).toBe(1);
    expect(next.currentStreak).toBe(1);
    expect(next.maxStreak).toBe(1);
    expect(next.guessDistribution).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it("records a loss: increments played, resets streak, no distribution change", () => {
    const prev = { ...DEFAULT_STATS, currentStreak: 4, maxStreak: 4, gamesPlayed: 4, gamesWon: 4 };
    const next = computeNextStats(prev, false, 6);
    expect(next.gamesPlayed).toBe(5);
    expect(next.gamesWon).toBe(4);
    expect(next.currentStreak).toBe(0);
    expect(next.maxStreak).toBe(4);
    expect(next.guessDistribution).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("keeps maxStreak when current streak surpasses it", () => {
    const prev = { ...DEFAULT_STATS, currentStreak: 2, maxStreak: 2, gamesPlayed: 2, gamesWon: 2 };
    const next = computeNextStats(prev, true, 1);
    expect(next.currentStreak).toBe(3);
    expect(next.maxStreak).toBe(3);
    expect(next.guessDistribution[0]).toBe(1);
  });

  it("does not mutate the previous stats object", () => {
    const prev = { ...DEFAULT_STATS };
    computeNextStats(prev, true, 2);
    expect(prev.guessDistribution).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
