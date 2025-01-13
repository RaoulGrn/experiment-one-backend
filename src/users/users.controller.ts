import { 
  Controller, 
  Get, 
  Post, 
  Delete,
  Param, 
  UseGuards, 
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import * as path from 'path';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('leaderboard')
  async getLeaderboard() {
    const users = await this.usersService.getLeaderboard();
    return users.map((user, index) => ({
      rank: index + 1,
      username: user.username,
      wins: user.wins,
      losses: user.losses,
      gamesPlayed: user.gamesPlayed,
      winRate: user.gamesPlayed > 0 
        ? Math.round((user.wins / user.gamesPlayed) * 100) 
        : 0,
    }));
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats() {
    const users = await this.usersService.getLeaderboard();
    return users.map(user => ({
      username: user.username,
      wins: user.wins,
      losses: user.losses,
      gamesPlayed: user.gamesPlayed,
      winRate: user.gamesPlayed > 0 
        ? Math.round((user.wins / user.gamesPlayed) * 100) 
        : 0,
    }));
  }

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('avatar', {
    fileFilter: (req, file, cb) => {
      // Check file type
      if (!file.mimetype.match(/^image\/(jpg|jpeg|png|gif)$/)) {
        return cb(new BadRequestException('Only image files are allowed!'), false);
      }
      cb(null, true);
    },
    limits: {
      fileSize: 5 * 1024 * 1024 // 5MB
    }
  }))
  async uploadAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const user = await this.usersService.updateAvatar(req.user.id, file);
    return { avatarUrl: user.avatarUrl };
  }

  @Delete('avatar')
  @UseGuards(JwtAuthGuard)
  async removeAvatar(@Request() req) {
    const user = await this.usersService.removeAvatar(req.user.id);
    return { message: 'Avatar removed successfully' };
  }

  @Get('uploads/:filename')
  async serveAvatar(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = path.join(process.cwd(), 'uploads', filename);
    return res.sendFile(filePath);
  }
} 