export interface Company {
  ticker: string;
  name: string;
}

export type GameStatus = 'playing' | 'won' | 'lost';

export interface RevenuePoint {
  x: string; // fake sequential period label, e.g. "Q1" — carries no real filing-quarter info
  y: number; // real quarterly revenue in USD; hidden from the player until solved/hover
}

export interface GameDayAnswer {
  ticker: string;
  companyName: string;
}

export interface GameDayPayload {
  gameId: number;
  dateString: string; // YYYY-MM-DD
  firstLetter: string;
  sector: string;
  marketCapTier: string;
  triviaHints: [string, string];
  revenueData: RevenuePoint[];
  netIncomeTrend: 'up' | 'down';
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
