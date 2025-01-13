export interface Player {
  id: string;
  username: string;
  socketId: string;
  choice?: 'rock' | 'paper' | 'scissors';
  queuedAt?: Date;
}

export interface Game {
  id: string;
  players: Player[];
  status: 'waiting' | 'playing' | 'finished';
  winner?: Player;
  startedAt: Date;
}

export type Choice = 'rock' | 'paper' | 'scissors';

export type GameStatus = 'waiting' | 'playing' | 'finished';

export interface ChatMessage {
  playerId: string;
  message: string;
  timestamp: Date;
}

export interface GameState {
  id: string;
  player1: string;
  player2: string;
  player1Username: string;
  player2Username: string;
  player1AvatarUrl?: string;
  player2AvatarUrl?: string;
  player1Choice?: Choice;
  player2Choice?: Choice;
  player1Score: number;
  player2Score: number;
  round: number;
  currentRound: number;
  status: GameStatus;
  isFinished: boolean;
  roundWinner?: string;
  moveTimeLeft: number;
  chatMessages: ChatMessage[];
  lastMoveTime?: Date;
  winner?: string;
}

export interface PlayerChoice {
  playerId: string;
  choice: 'rock' | 'paper' | 'scissors';
}

export interface GameResult {
  winner: string;
  player1Score: number;
  player2Score: number;
  totalRounds: number;
} 