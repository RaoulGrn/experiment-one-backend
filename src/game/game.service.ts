import { Injectable } from '@nestjs/common';
import { GameState, PlayerChoice, ChatMessage } from './interfaces/game.interface';
import { UsersService } from '../users/users.service';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

const MOVE_TIMEOUT_SECONDS = 30;

@Injectable()
export class GameService {
  private games: Map<string, GameState> = new Map();
  private gameTimers: Map<string, { interval: NodeJS.Timeout; timeout: NodeJS.Timeout }> = new Map();
  private io: Server;

  constructor(private usersService: UsersService) {}

  setIoInstance(io: Server) {
    this.io = io;
  }

  async createGame(player1Id: string, player2Id: string): Promise<GameState> {
    const player1 = await this.usersService.findById(player1Id);
    const player2 = await this.usersService.findById(player2Id);

    if (!player1 || !player2) {
      throw new Error('Players not found');
    }

    const gameState: GameState = {
      id: uuidv4(),
      player1: player1Id,
      player2: player2Id,
      player1Username: player1.username,
      player2Username: player2.username,
      player1AvatarUrl: player1.avatarUrl,
      player2AvatarUrl: player2.avatarUrl,
      player1Score: 0,
      player2Score: 0,
      round: 1,
      currentRound: 1,
      status: 'waiting',
      isFinished: false,
      moveTimeLeft: MOVE_TIMEOUT_SECONDS,
      chatMessages: [],
      lastMoveTime: new Date()
    };

    this.games.set(gameState.id, gameState);
    return gameState;
  }

  makeChoice(gameId: string, choice: PlayerChoice): GameState {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    if (game.isFinished) {
      throw new Error('Game is already finished');
    }

    // Verify player is in the game
    const isPlayer1 = choice.playerId === game.player1;
    const isPlayer2 = choice.playerId === game.player2;
    if (!isPlayer1 && !isPlayer2) {
      throw new Error('Player not in game');
    }

    // Check if player already made a choice this round
    if ((isPlayer1 && game.player1Choice) || (isPlayer2 && game.player2Choice)) {
      throw new Error('Choice already made this round');
    }

    // Record the choice
    if (isPlayer1) {
      game.player1Choice = choice.choice;
    } else {
      game.player2Choice = choice.choice;
    }

    // If both players made their choices, determine round winner
    if (game.player1Choice && game.player2Choice) {
      this.determineRoundWinner(game);
      
      // Check if game is finished
      if (game.player1Score >= 3 || game.player2Score >= 3) {
        game.isFinished = true;
        game.winner = game.player1Score > game.player2Score ? game.player1 : game.player2;
        this.handleGameEnd(game);
        this.clearTimers(gameId);
      } else {
        // Clear timers before starting new round
        this.clearTimers(gameId);
        
        // Start new round after a delay
        setTimeout(() => {
          game.currentRound++;
          game.player1Choice = undefined;
          game.player2Choice = undefined;
          game.roundWinner = undefined;
          game.moveTimeLeft = MOVE_TIMEOUT_SECONDS;
          
          // Update state and start new timer
          this.games.set(gameId, game);
          
          // Broadcast to each player with their correct isPlayer1 value
          this.broadcastGameState(gameId, game);
          
          this.startMoveTimer(gameId);
        }, 2000);
      }
    }

    // Update and broadcast state
    this.games.set(gameId, game);
    this.broadcastGameState(gameId, game);
    
    return game;
  }

  private broadcastGameState(gameId: string, game: GameState) {
    // Get both player sockets from the room
    const room = this.io.sockets.adapter.rooms.get(gameId);
    if (!room) return;

    // Send state to each socket with correct isPlayer1 value
    for (const socketId of room) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.data?.userId) {
        const isPlayer1 = socket.data.userId === game.player1;
        socket.emit('game_state', {
          ...game,
          isPlayer1
        });
      }
    }
  }

  private startMoveTimer(gameId: string) {
    const game = this.games.get(gameId);
    if (!game || game.isFinished) return;

    // Clear any existing timers
    this.clearTimers(gameId);

    // Reset move time
    game.moveTimeLeft = MOVE_TIMEOUT_SECONDS;
    this.broadcastGameState(gameId, game);

    // Create interval for countdown
    const interval = setInterval(() => {
      const currentGame = this.games.get(gameId);
      if (!currentGame || currentGame.isFinished) {
        this.clearTimers(gameId);
        return;
      }

      currentGame.moveTimeLeft--;
      
      // Check if timer has expired
      if (currentGame.moveTimeLeft <= 0) {
        this.handleMoveTimeout(gameId);
        return;
      }

      // Update and broadcast state
      this.games.set(gameId, currentGame);
      this.broadcastGameState(gameId, currentGame);
    }, 1000);

    // Backup timeout
    const timeout = setTimeout(() => {
      this.handleMoveTimeout(gameId);
    }, MOVE_TIMEOUT_SECONDS * 1000);

    this.gameTimers.set(gameId, { interval, timeout });
  }

  private handleMoveTimeout(gameId: string) {
    const game = this.games.get(gameId);
    if (!game || game.isFinished) return;

    this.clearTimers(gameId);

    // If a player hasn't made a choice, they lose the round
    if (!game.player1Choice && !game.player2Choice) {
      // If neither player made a choice, no points awarded
      game.roundWinner = undefined;
    } else if (!game.player1Choice) {
      // Player 1 didn't choose, Player 2 wins
      game.player2Score++;
      game.roundWinner = game.player2;
    } else if (!game.player2Choice) {
      // Player 2 didn't choose, Player 1 wins
      game.player1Score++;
      game.roundWinner = game.player1;
    }

    // Check if game is finished
    if (game.player1Score >= 3 || game.player2Score >= 3) {
      game.isFinished = true;
      game.winner = game.player1Score > game.player2Score ? game.player1 : game.player2;
      this.handleGameEnd(game);
    } else {
      // Start new round after delay
      setTimeout(() => {
        game.currentRound++;
        game.player1Choice = undefined;
        game.player2Choice = undefined;
        game.roundWinner = undefined;
        game.moveTimeLeft = MOVE_TIMEOUT_SECONDS;

        // Update state and start new timer
        this.games.set(gameId, game);
        this.broadcastGameState(gameId, game);
        this.startMoveTimer(gameId);
      }, 2000);
    }

    // Update and broadcast state immediately
    this.games.set(gameId, game);
    this.broadcastGameState(gameId, game);
  }

  private clearTimers(gameId: string) {
    const timers = this.gameTimers.get(gameId);
    if (timers) {
      clearInterval(timers.interval);
      clearTimeout(timers.timeout);
      this.gameTimers.delete(gameId);
    }
  }

  private determineRoundWinner(game: GameState) {
    const p1Choice = game.player1Choice!;
    const p2Choice = game.player2Choice!;

    if (p1Choice === p2Choice) {
      game.roundWinner = undefined; // Tie
      return;
    }

    const winningCombos = {
      rock: 'scissors',
      paper: 'rock',
      scissors: 'paper',
    };

    if (winningCombos[p1Choice] === p2Choice) {
      game.roundWinner = game.player1;
      game.player1Score++;
    } else {
      game.roundWinner = game.player2;
      game.player2Score++;
    }
  }

  private async handleGameEnd(game: GameState) {
    if (game.winner) {
      await this.usersService.updateStats(game.winner, true);
      const loserId = game.winner === game.player1 ? game.player2 : game.player1;
      await this.usersService.updateStats(loserId, false);
    }
  }

  getGame(gameId: string): GameState | undefined {
    return this.games.get(gameId);
  }

  deleteGame(gameId: string) {
    this.clearTimers(gameId);
    this.games.delete(gameId);
  }

  private generateGameId(player1Id: string, player2Id: string): string {
    return `${player1Id}-${player2Id}`;
  }

  addChatMessage(gameId: string, playerId: string, message: string): GameState {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error('Game not found');
    }

    // Verify player is in the game
    if (playerId !== game.player1 && playerId !== game.player2) {
      throw new Error('Player not in game');
    }

    const chatMessage: ChatMessage = {
      playerId,
      message,
      timestamp: new Date()
    };

    game.chatMessages.push(chatMessage);
    this.games.set(gameId, game);
    
    // Broadcast updated game state
    this.broadcastGameState(gameId, game);

    return game;
  }
} 