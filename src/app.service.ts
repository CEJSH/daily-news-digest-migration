import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo(): { service: string; version: string; migratedFrom: string } {
    return {
      service: 'daily-news-digest-be-nest',
      version: '1.0.0',
      migratedFrom: 'daily-news-digest-be (python)',
    };
  }
}
