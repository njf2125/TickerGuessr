import { describe, it, expect } from "vitest";
import { buildShareText } from "./share";
import type { GuessResult } from "@/types/game";

const wrong = (ticker: string): GuessResult => ({ ticker, name: ticker, isCorrect: false });
const right = (ticker: string): GuessResult => ({ ticker, name: ticker, isCorrect: true });

describe("buildShareText", () => {
  it("formats a 3-attempt win with a padded emoji grid", () => {
    const guesses = [wrong("AMZN"), wrong("MSFT"), right("AAPL")];
    expect(buildShareText(guesses, "won", 1)).toBe(
      "TickerGuessr #1 📈\n🟥🟥🟩⬜⬜⬜\nCompleted in 3 attempts!\nhttps://tickerguessr.app"
    );
  });

  it("uses singular 'attempt' for a first-guess win", () => {
    expect(buildShareText([right("AAPL")], "won", 7)).toBe(
      "TickerGuessr #7 📈\n🟩⬜⬜⬜⬜⬜\nCompleted in 1 attempt!\nhttps://tickerguessr.app"
    );
  });

  it("formats a loss with all six wrong and the consolation line", () => {
    const guesses = ["A", "B", "C", "D", "E", "F"].map(wrong);
    expect(buildShareText(guesses, "lost", 2)).toBe(
      "TickerGuessr #2 📈\n🟥🟥🟥🟥🟥🟥\nBetter luck tomorrow!\nhttps://tickerguessr.app"
    );
  });
});
