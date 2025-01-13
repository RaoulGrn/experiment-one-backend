export interface User {
  id: string;
  username: string;
  password: string;
  email: string;
  avatarUrl?: string;
  gamesPlayed: number;
  gamesWon: number;
  wins: number;
  losses: number;
  createdAt: Date;
  updatedAt: Date;
} 