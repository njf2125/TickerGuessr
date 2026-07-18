interface HintContainerProps {
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
  firstLetter: string;
  guessCount: number;
}

// A hint still carrying the generated `TODO:` placeholder is never rendered —
// guards against a forgotten day shipping placeholder text to players.
function isReal(hint: string | undefined): hint is string {
  return !!hint && !hint.startsWith("TODO:");
}

// Reveal curve is staggered so every wrong guess (through 5) unlocks something:
// g1 sector, g2 market cap, g3 trivia[0], g4 trivia[1], g5 starting letter.
// (g3 also flips on the chart's hover tooltip, in StockChart — a bonus, not
// the guess's real hint, since it's invisible/unreliable on touch devices.)
export function HintContainer({
  sector,
  marketCapTier,
  triviaHints,
  firstLetter,
  guessCount,
}: HintContainerProps) {
  if (guessCount < 1) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <span className="text-xs px-3 py-1 rounded-full bg-blue-900/50 text-blue-300 border border-blue-800">
          📊 {sector}
        </span>
        {guessCount >= 2 && (
          <span className="text-xs px-3 py-1 rounded-full bg-purple-900/50 text-purple-300 border border-purple-800">
            💰 {marketCapTier}
          </span>
        )}
        {guessCount >= 5 && (
          <span className="text-xs px-3 py-1 rounded-full bg-amber-900/50 text-amber-300 border border-amber-800">
            🔤 Starts with {firstLetter}
          </span>
        )}
      </div>
      {guessCount >= 3 && isReal(triviaHints[0]) && (
        <p className="text-xs text-gray-300 bg-gray-800/60 rounded-lg px-3 py-2 leading-relaxed">
          💡 {triviaHints[0]}
        </p>
      )}
      {guessCount >= 4 && isReal(triviaHints[1]) && (
        <p className="text-xs text-gray-300 bg-gray-800/60 rounded-lg px-3 py-2 leading-relaxed">
          💡 {triviaHints[1]}
        </p>
      )}
    </div>
  );
}
