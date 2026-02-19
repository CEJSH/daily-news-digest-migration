import { BadRequestException } from '@nestjs/common';
import { DigestController } from './digest.controller';
import { DailyDigest } from './types/digest.types';

function makeDigest(): DailyDigest {
  return {
    date: '2026-02-16',
    selectionCriteria: 'test',
    editorNote: 'test',
    question: 'test',
    lastUpdatedAt: '2026-02-16T00:00:00.000+09:00',
    items: [],
  };
}

describe('DigestController', () => {
  const digest = makeDigest();
  const generator = {
    generateDigest: jest.fn().mockResolvedValue(digest),
  };
  const storage = {
    loadMetrics: jest.fn(),
  };
  const controller = new DigestController(generator as never, storage as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses topLimit and force query safely', async () => {
    await controller.getDigest('true', '12.9');

    expect(generator.generateDigest).toHaveBeenCalledWith({
      forceRegenerate: true,
      topLimit: 12,
    });
  });

  it('throws on invalid topLimit query', async () => {
    await expect(controller.getDigest('1', 'abc')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('parses boolean body values correctly', async () => {
    await controller.generateDigest('10', 'false');

    expect(generator.generateDigest).toHaveBeenCalledWith({
      topLimit: 10,
      forceRegenerate: false,
    });
  });
});
