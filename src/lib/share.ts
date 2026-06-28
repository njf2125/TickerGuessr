import { GuessResult, GameStatus } from "@/types/game";

const MAX_ATTEMPTS = 6;
const SHARE_URL = "https://tickerguessr.app";

export function buildShareText(
  guesses: GuessResult[],
  status: GameStatus,
  gameId: number
): string {
  const grid = Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
    const g = guesses[i];
    if (!g) return "⬜";
    return g.isCorrect ? "🟩" : "🟥";
  }).join("");

  const outcome =
    status === "won"
      ? `Completed in ${guesses.length} attempt${guesses.length === 1 ? "" : "s"}!`
      : "Better luck tomorrow!";

  return `TickerGuessr #${gameId} 📈\n${grid}\n${outcome}\n${SHARE_URL}`;
}
