import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { GameState, PlayerChoice } from './interfaces/game.interface';
import { UsersService } from '../users/users.service';
import { Logger } from '@nestjs/common';

interface QueuedPlayer {
  id: string;
  username: string;
  socketId: string;
  queuedAt: Date;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  path: '/socket.io/',
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server: Server;

  private playerSockets: Map<string, Socket> = new Map(); // userId -> Socket
  private matchmakingQueue: QueuedPlayer[] = [];
  private matchmakingInterval: NodeJS.Timeout;

  constructor(
    private gameService: GameService,
    private usersService: UsersService,
  ) {
    // Process matchmaking every 2 seconds
    this.matchmakingInterval = setInterval(() => this.processMatchmaking(), 2000);
  }

  afterInit(server: Server) {
    this.logger.log('WebSocket Gateway initialized');
    this.gameService.setIoInstance(server);
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    // Add authentication middleware
    client.use(async (packet, next) => {
      const userId = client.handshake.auth.userId;
      if (userId) {
        // Re-authenticate if we have the userId
        const user = await this.usersService.findById(userId);
        if (user) {
          client.data = { userId, username: user.username };
          this.playerSockets.set(userId, client);
        }
      }
      next();
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Find and remove player from queue and mappings
    for (const [userId, socket] of this.playerSockets.entries()) {
      if (socket.id === client.id) {
        this.playerSockets.delete(userId);
        this.removeFromQueue(userId);
        break;
      }
    }
  }

  @SubscribeMessage('authenticate')
  async handleAuthenticate(client: Socket, data: { id: string; username: string }) {
    console.log('Player authenticating:', data);
    try {
      const user = await this.usersService.findById(data.id);
      if (!user) {
        throw new Error('User not found');
      }

      // Store socket and user data
      this.playerSockets.set(data.id, client);
      client.data = { userId: data.id, username: data.username };
      
      // Store auth data in socket handshake for reconnection
      client.handshake.auth = { userId: data.id };
      
      console.log('Player authenticated:', data);
      return { status: 'authenticated' };
    } catch (error) {
      console.error('Authentication error:', error);
      return { status: 'error', message: error.message };
    }
  }

  @SubscribeMessage('findGame')
  async handleFindGame(client: Socket) {
    console.log('Find game request from client:', client.id);
    // Find player data from socket
    let playerId: string | undefined;
    let playerUsername: string | undefined;

    for (const [userId, socket] of this.playerSockets.entries()) {
      if (socket.id === client.id) {
        playerId = userId;
        const user = await this.usersService.findById(userId);
        if (user) {
          playerUsername = user.username;
        }
        break;
      }
    }

    if (!playerId || !playerUsername) {
      console.log('Player not authenticated');
      return { error: 'Player not authenticated' };
    }

    // Add to queue if not already in it
    if (!this.matchmakingQueue.find(p => p.id === playerId)) {
      const queuedPlayer: QueuedPlayer = {
        id: playerId,
        username: playerUsername,
        socketId: client.id,
        queuedAt: new Date(),
      };
      this.matchmakingQueue.push(queuedPlayer);
      console.log('Added player to queue:', queuedPlayer);
      this.emitQueueUpdate();
    }

    return { status: 'queued' };
  }

  @SubscribeMessage('make_choice')
  async handleMakeChoice(client: Socket, payload: { gameId: string; choice: 'rock' | 'paper' | 'scissors' }) {
    try {
      // Find player ID from socket map
      let playerId: string | undefined;
      for (const [userId, socket] of this.playerSockets.entries()) {
        if (socket.id === client.id) {
          playerId = userId;
          break;
        }
      }

      if (!playerId) {
        this.logger.error('User not authenticated for socket:', client.id);
        return { error: 'User not authenticated' };
      }

      this.logger.log(`Making choice for user ${playerId}:`, payload);
      
      // Join the game room if not already joined
      client.join(payload.gameId);

      const game = this.gameService.makeChoice(payload.gameId, {
        playerId: playerId,
        choice: payload.choice
      });

      return { status: 'success', game };
    } catch (error) {
      this.logger.error('Error making choice:', error);
      return { error: error.message };
    }
  }

  @SubscribeMessage('chat_message')
  async handleChatMessage(client: Socket, payload: { gameId: string; message: string }) {
    try {
      // Find player ID from socket map
      let playerId: string | undefined;
      for (const [userId, socket] of this.playerSockets.entries()) {
        if (socket.id === client.id) {
          playerId = userId;
          break;
        }
      }

      if (!playerId) {
        this.logger.error('User not authenticated for socket:', client.id);
        return { error: 'User not authenticated' };
      }

      this.logger.log(`Chat message from user ${playerId}:`, payload);
      
      // Join the game room if not already joined
      client.join(payload.gameId);

      const game = this.gameService.addChatMessage(payload.gameId, playerId, payload.message);

      return { status: 'success', game };
    } catch (error) {
      this.logger.error('Error sending chat message:', error);
      return { error: error.message };
    }
  }

  private async processMatchmaking() {
    if (this.matchmakingQueue.length < 2) return;

    console.log('Processing matchmaking queue:', this.matchmakingQueue.length, 'players waiting');

    // Sort by queue time
    this.matchmakingQueue.sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());

    // Match first two players
    const player1 = this.matchmakingQueue.shift()!;
    const player2 = this.matchmakingQueue.shift()!;

    console.log('Matching players:', { player1: player1.username, player2: player2.username });

    try {
      // Create game and broadcast to each player with their respective isPlayer1 value
      const gameState = await this.gameService.createGame(player1.id, player2.id);
      
      // Get sockets for both players
      const player1Socket = this.playerSockets.get(player1.id);
      const player2Socket = this.playerSockets.get(player2.id);

      if (player1Socket) {
        player1Socket.emit('game_state', { ...gameState, isPlayer1: true });
      }
      if (player2Socket) {
        player2Socket.emit('game_state', { ...gameState, isPlayer1: false });
      }

      // Update queue for remaining players
      this.emitQueueUpdate();
    } catch (error) {
      console.error('Error creating game:', error);
      // Put players back in queue if there's an error
      this.matchmakingQueue.unshift(player1, player2);
    }
  }

  private emitQueueUpdate() {
    this.matchmakingQueue.forEach((player, index) => {
      const socket = this.playerSockets.get(player.id);
      if (socket) {
        socket.emit('queueUpdate', {
          position: index + 1,
          total: this.matchmakingQueue.length,
          estimatedTime: (index + 1) * 5, // 5 seconds per position
        });
      }
    });
  }

  private removeFromQueue(userId: string) {
    const index = this.matchmakingQueue.findIndex(p => p.id === userId);
    if (index !== -1) {
      console.log('Removing player from queue:', userId);
      this.matchmakingQueue.splice(index, 1);
      this.emitQueueUpdate();
    }
  }

  private generateGameId(player1Id: string, player2Id: string): string {
    return `${player1Id}-${player2Id}`;
  }
} 