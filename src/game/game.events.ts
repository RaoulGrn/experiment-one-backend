import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Game } from './interfaces/game.interface';

@Injectable()
export class GameEvents {
  constructor(private eventEmitter: EventEmitter2) {}

  emitGameCreated(game: Game) {
    this.eventEmitter.emit('game.created', game);
  }

  emitQueueUpdated(playerId: string, position: number, total: number) {
    this.eventEmitter.emit('queue.updated', { playerId, position, total });
  }
} 