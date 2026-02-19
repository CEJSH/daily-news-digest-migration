import { promises as fs } from 'node:fs';
import { DigestStorageService } from './digest-storage.service';

describe('DigestStorageService', () => {
  let service: DigestStorageService;

  beforeEach(() => {
    service = new DigestStorageService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('excludes targetDate entries from recent cluster map', async () => {
    jest.spyOn(fs, 'readFile').mockResolvedValue(
      JSON.stringify({
        byDate: {
          '2026-02-16': ['same-day-a', 'same-day-b'],
          '2026-02-15': ['prev-day-a'],
          '2026-02-14': ['prev-day-b'],
        },
      }),
    );

    const result = await service.loadRecentClusterMap('2026-02-16');

    expect(result.has('same-day-a')).toBe(false);
    expect(result.has('same-day-b')).toBe(false);
    expect(result.has('prev-day-a')).toBe(true);
    expect(result.has('prev-day-b')).toBe(true);
  });

  it('writes json atomically with temp file rename', async () => {
    const mkdirSpy = jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    const writeSpy = jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    const renameSpy = jest.spyOn(fs, 'rename').mockResolvedValue(undefined);
    const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    await service.saveDigest({
      date: '2026-02-16',
      selectionCriteria: 'test',
      editorNote: 'test',
      question: 'test',
      lastUpdatedAt: '2026-02-16T00:00:00.000+09:00',
      items: [],
    });

    expect(mkdirSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});
