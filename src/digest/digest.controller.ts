import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { DailyDigest } from './types/digest.types';
import { DigestGeneratorService } from './services/digest-generator.service';
import { DigestStorageService } from './services/digest-storage.service';

@Controller()
export class DigestController {
  constructor(
    private readonly digestGeneratorService: DigestGeneratorService,
    private readonly digestStorageService: DigestStorageService,
  ) {}

  @Get('health')
  getHealth(): { status: string; service: string } {
    return {
      status: 'ok',
      service: 'daily-news-digest-be-nest',
    };
  }

  @Get('digest')
  async getDigest(
    @Query('force') force?: string,
    @Query('topLimit') topLimitRaw?: string,
  ): Promise<DailyDigest> {
    const topLimit = this.parseTopLimit(topLimitRaw);
    return this.digestGeneratorService.generateDigest({
      forceRegenerate: this.parseBoolean(force, 'force'),
      topLimit,
    });
  }

  @Post('digest/generate')
  async generateDigest(
    @Body('topLimit') topLimitRaw?: unknown,
    @Body('forceRegenerate') forceRegenerate?: unknown,
  ): Promise<DailyDigest> {
    return this.digestGeneratorService.generateDigest({
      topLimit: this.parseTopLimit(topLimitRaw),
      forceRegenerate: this.parseBoolean(forceRegenerate, 'forceRegenerate'),
    });
  }

  @Get('digest/metrics')
  async getMetrics(): Promise<unknown> {
    return (
      (await this.digestStorageService.loadMetrics()) ?? {
        type: 'metrics_summary',
        message: 'metrics not found yet',
      }
    );
  }

  // FE 호환용 정적 경로 alias
  @Get('daily_digest.json')
  async getDigestJson(): Promise<DailyDigest> {
    return this.digestGeneratorService.generateDigest();
  }

  private parseTopLimit(value: unknown): number | undefined {
    if (value == null || value === '') {
      return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BadRequestException('topLimit must be a positive number');
    }
    return Math.floor(parsed);
  }

  private parseBoolean(value: unknown, fieldName: string): boolean {
    if (value == null || value === '') {
      return false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'y'].includes(lowered)) {
        return true;
      }
      if (['0', 'false', 'no', 'n'].includes(lowered)) {
        return false;
      }
    }

    throw new BadRequestException(`${fieldName} must be a boolean value`);
  }
}
