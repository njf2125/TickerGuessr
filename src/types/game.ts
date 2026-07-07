export interface Company {
  ticker: string;
  name: string;
}

export type CandleInterval = '1d' | '1w' | '1mo';
export type GameStatus = 'playing' | 'won' | 'lost';

export interface OHLCPoint {
  x: string;
  y: [number, number, number, number]; // [Open, High, Low, Close]
}

export interface GameDayAnswer {
  ticker: string;
  companyName: string;
}

export interface GameDayPayload {
  gameId: number;
  dateString: string; // YYYY-MM-DD
  firstLetter: string;
  interval: CandleInterval;
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
  candlestickData: OHLCPoint[];
}

export interface GuessResult {
  ticker: string;
  name: string;
  isCorrect: boolean;
  isSkip?: boolean;
}

export interface PlayerStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: [number, number, number, number, number, number];
}

export interface PersistedGameState {
  dateString: string;
  guesses: GuessResult[];
  status: GameStatus;
}
