import { CandidateItem } from '../types/digest.types';
import { AiEnricherService } from './ai-enricher.service';
import { DigestScoringService } from './digest-scoring.service';

const baseCandidate = (overrides: Partial<CandidateItem> = {}): CandidateItem =>
  ({
    title: '기본 제목',
    link: 'https://example.com/news',
    summary: '기본 요약입니다.',
    topic: 'IT',
    sourceName: '연합뉴스',
    sourceRaw: '연합뉴스',
    publishedAt: '2026-02-17T00:00:00.000+09:00',
    ageHours: 2,
    impactSignals: ['policy'],
    score: 1,
    dedupeKey: 'dedupe-key',
    clusterKey: 'cluster-key',
    readTimeSec: 40,
    matchedTo: null,
    ...overrides,
  }) as CandidateItem;

describe('AiEnricherService', () => {
  it('keeps allowed category labels from model output', async () => {
    const llmClient = {
      generateJson: jest.fn().mockResolvedValue({
        title_ko: '요약 제목',
        summary_lines: ['핵심 요약'],
        category_label: '정책',
      }),
    };
    const service = new AiEnricherService(
      llmClient as never,
      new DigestScoringService(),
    );

    const result = await service.enrichItem(baseCandidate());

    expect(result?.categoryLabel).toBe('정책');
  });

  it('falls back to topic-based mapping when model category is invalid', async () => {
    const llmClient = {
      generateJson: jest.fn().mockResolvedValue({
        title_ko: '요약 제목',
        summary_lines: ['핵심 요약'],
        category_label: '분류불가',
      }),
    };
    const service = new AiEnricherService(
      llmClient as never,
      new DigestScoringService(),
    );

    const result = await service.enrichItem(
      baseCandidate({ topic: 'IT', title: 'AI 반도체 투자 확대' }),
    );

    expect(result?.categoryLabel).toBe('기술');
  });

  it('falls back using title/summary keywords when topic is empty', async () => {
    const llmClient = {
      generateJson: jest.fn().mockResolvedValue({
        title_ko: '요약 제목',
        summary_lines: ['핵심 요약'],
        category_label: '',
      }),
    };
    const service = new AiEnricherService(
      llmClient as never,
      new DigestScoringService(),
    );

    const result = await service.enrichItem(
      baseCandidate({
        topic: '',
        title: '국회, AI 관련 입법 추진',
        summary: '시행령과 가이드라인 개정 논의가 본격화됐다.',
      }),
    );

    expect(result?.categoryLabel).toBe('정책');
  });
});
