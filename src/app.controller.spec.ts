import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should return migration metadata', () => {
    expect(appController.getRoot()).toEqual({
      service: 'daily-news-digest-be-nest',
      version: '1.0.0',
      migratedFrom: 'daily-news-digest-be (python)',
    });
  });
});
