import { GuessResult } from "@/types/game";

interface AttemptMatrixProps {
  guesses: GuessResult[];
  maxAttempts?: number;
}

export function AttemptMatrix({ guesses, maxAttempts = 6 }: AttemptMatrixProps) {
  const empties = maxAttempts - guesses.length;

  return (
    <div className="flex flex-col gap-1.5">
      {guesses.map((guess, i) => (
        <div
          key={i}
          className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium border ${
            guess.isSkip
              ? "bg-gray-800/40 border-gray-700 border-dashed text-gray-400"
              : guess.isCorrect
                ? "bg-green-900/40 border-green-700 text-green-300"
                : "bg-red-900/30 border-red-800 text-red-300"
          }`}
        >
          <span className="font-mono font-bold shrink-0">{guess.isSkip ? "—" : guess.ticker}</span>
          <span className="text-xs opacity-75 truncate ml-2 flex-1 min-w-0">
            {guess.isSkip ? "Skipped for a hint" : guess.name}
          </span>
          <span className="ml-2 text-base shrink-0">
            {guess.isSkip ? "⏭️" : guess.isCorrect ? "🟩" : "🟥"}
          </span>
        </div>
      ))}
      {Array.from({ length: empties }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="flex items-center px-3 py-2 rounded-lg border border-gray-700 border-dashed h-10"
        />
      ))}
    </div>
  );
}
