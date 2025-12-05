export type DuelWinner = "player" | "bot" | "draw";

export interface GameResultBase {
  finalScore: number;
  durationMs: number;
  winner: DuelWinner;
  summary?: string;
}

export interface SpeedMatchResult extends GameResultBase {
  playerScore: number;
  botScore: number;
  correctClicks: number;
  wrongClicks: number;
}

export interface MemoryDuelResult extends GameResultBase {
  playerPairs: number;
  botPairs: number;
  totalPairs: number;
}

export interface TacticsLiteResult extends GameResultBase {
  turnsTaken: number;
  playerUnitsRemaining: number;
  botUnitsRemaining: number;
}

export interface Connect3Result extends GameResultBase {
  playerScore: number;
  botScore: number;
  movesMade: number;
}

export interface RpsPlusResult extends GameResultBase {
  rounds: Array<{
    round: number;
    playerMove: string;
    botMove: string;
    outcome: DuelWinner;
  }>;
  playerRoundsWon: number;
  botRoundsWon: number;
}
