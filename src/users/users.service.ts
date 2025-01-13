import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  async create(createUserDto: { username: string; email: string; password: string }): Promise<User> {
    const { username, email, password } = createUserDto;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new this.userModel({
      username,
      email,
      password: hashedPassword,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
    });

    return user.save();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email });
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id);
  }

  async getLeaderboard(): Promise<User[]> {
    return this.userModel
      .find({ gamesPlayed: { $gt: 0 } })
      .sort({ wins: -1, gamesPlayed: 1 })
      .limit(10)
      .select('username wins losses gamesPlayed');
  }

  async updateStats(userId: string, won: boolean): Promise<User> {
    const update = {
      $inc: {
        gamesPlayed: 1,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
      },
    };
    return this.userModel.findByIdAndUpdate(userId, update, { new: true });
  }

  async updateAvatar(userId: string, file: Express.Multer.File): Promise<User> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Delete old avatar if exists
    if (user.avatarUrl) {
      try {
        const oldPath = path.join(process.cwd(), 'uploads', path.basename(user.avatarUrl));
        await fs.unlink(oldPath);
      } catch (error) {
        console.error('Error deleting old avatar:', error);
      }
    }

    // Generate unique filename
    const fileExt = path.extname(file.originalname);
    const fileName = `${uuidv4()}${fileExt}`;
    const filePath = path.join(process.cwd(), 'uploads', fileName);

    // Ensure uploads directory exists
    await fs.mkdir(path.join(process.cwd(), 'uploads'), { recursive: true });

    // Save file
    await fs.writeFile(filePath, file.buffer);

    // Update user avatar URL
    const avatarUrl = `/uploads/${fileName}`;
    user.avatarUrl = avatarUrl;
    await user.save();

    return user;
  }

  async removeAvatar(userId: string): Promise<User> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.avatarUrl) {
      try {
        const filePath = path.join(process.cwd(), 'uploads', path.basename(user.avatarUrl));
        await fs.unlink(filePath);
      } catch (error) {
        console.error('Error deleting avatar:', error);
      }
    }

    user.avatarUrl = undefined;
    await user.save();

    return user;
  }
} 