import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DEDUPE_HISTORY_PATH,
  DEDUPE_RECENT_DAYS,
  METRICS_JSON,
  OUTPUT_JSON,
} from '../config/digest.constants';
import { DailyDigest, DigestMetrics } from '../types/digest.types';

interface DedupeHistory {
  byDate: Record<string, string[]>;
}

@Injectable()
export class DigestStorageService {
  async loadDigest(): Promise<DailyDigest | null> {
    return this.safeReadJson<DailyDigest>(OUTPUT_JSON);
  }

  async saveDigest(digest: DailyDigest): Promise<void> {
    await this.safeWriteJson(OUTPUT_JSON, digest);
  }

  async loadMetrics(): Promise<DigestMetrics | null> {
    return this.safeReadJson<DigestMetrics>(METRICS_JSON);
  }

  async saveMetrics(metrics: DigestMetrics): Promise<void> {
    await this.safeWriteJson(METRICS_JSON, metrics);
  }

  async loadRecentClusterMap(targetDate: string): Promise<Map<string, string>> {
    const history = (await this.safeReadJson<DedupeHistory>(
      DEDUPE_HISTORY_PATH,
    )) ?? {
      byDate: {},
    };

    const dates = this.recentDates(targetDate, DEDUPE_RECENT_DAYS).filter(
      (date) => date !== targetDate,
    );
    const clusterMap = new Map<string, string>();

    for (const date of dates) {
      const keys = history.byDate[date] ?? [];
      for (const clusterKey of keys) {
        clusterMap.set(clusterKey, date);
      }
    }

    return clusterMap;
  }

  async updateHistory(digest: DailyDigest): Promise<void> {
    const history = (await this.safeReadJson<DedupeHistory>(
      DEDUPE_HISTORY_PATH,
    )) ?? {
      byDate: {},
    };

    history.byDate[digest.date] = digest.items
      .map((item) => item.clusterKey)
      .filter((key): key is string => Boolean(key));

    const dates = Object.keys(history.byDate).sort();
    if (dates.length > DEDUPE_RECENT_DAYS + 5) {
      const removeCount = dates.length - (DEDUPE_RECENT_DAYS + 5);
      dates.slice(0, removeCount).forEach((date) => {
        delete history.byDate[date];
      });
    }

    await this.safeWriteJson(DEDUPE_HISTORY_PATH, history);
  }

  private async safeReadJson<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async safeWriteJson(
    filePath: string,
    payload: unknown,
  ): Promise<void> {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(
        tmpPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf-8',
      );
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw error;
    }
  }

  private recentDates(date: string, days: number): string[] {
    const start = new Date(`${date}T00:00:00+09:00`);
    if (Number.isNaN(start.getTime())) {
      return [];
    }

    const dates: string[] = [];
    for (let i = 0; i < days; i += 1) {
      const current = new Date(start);
      current.setDate(start.getDate() - i);
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      const day = String(current.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    return dates;
  }
}
