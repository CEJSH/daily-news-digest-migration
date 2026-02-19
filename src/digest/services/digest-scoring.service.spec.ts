import { DigestScoringService } from './digest-scoring.service';

describe('DigestScoringService', () => {
  let service: DigestScoringService;

  beforeEach(() => {
    service = new DigestScoringService();
  });

  it('drops item when publishedAt is missing (ageHours is null)', () => {
    const reason = service.getSkipReason({
      title: 'AI 반도체 수요 급증',
      summary: '주요 업체가 증설을 검토 중이다.',
      link: 'https://example.com/a',
      ageHours: null,
      impactSignals: [],
    });

    expect(reason).toBe('missing_published_at');
  });

  it('prioritizes policy category when policy/regulation keywords coexist with AI', () => {
    const category = service.mapTopicToCategory('AI 규제 국회 입법');

    expect(category).toBe('정책');
  });

  it('detects breaking markers in title/summary', () => {
    expect(
      service.isBreakingNews({
        title: '[속보] 반도체 수출통제 확대',
        summary: '미 상무부 발표',
      }),
    ).toBe(true);
    expect(
      service.isBreakingNews({
        title: '정책 브리핑',
        summary: 'breaking: major tariff update',
      }),
    ).toBe(true);
  });

  it('adds score boost to breaking items', () => {
    const normal = service.scoreItem({
      impactSignals: ['policy'],
      readTimeSec: 40,
      sourceName: 'Reuters',
      ageHours: 2,
      isBreaking: false,
    });
    const breaking = service.scoreItem({
      impactSignals: ['policy'],
      readTimeSec: 40,
      sourceName: 'Reuters',
      ageHours: 2,
      isBreaking: true,
    });

    expect(breaking).toBeGreaterThan(normal);
  });

  it('keeps hard-excluding promotional webinar content', () => {
    const reason = service.getSkipReason({
      title: 'AI 정책 웨비나 개최',
      summary: '무료 신청 접수',
      link: 'https://example.com/news/1',
      ageHours: 2,
      impactSignals: ['policy'],
    });

    expect(reason).toBe('hard_excluded_keyword');
  });

  it('does not hard-exclude contextual report article when macro/policy context exists', () => {
    const reason = service.getSkipReason({
      title: '미국 고용 리포트 발표, 금리 경로 재평가',
      summary: '관세 협상 변수도 함께 반영됐다.',
      link: 'https://example.com/report/update-1',
      ageHours: 3,
      impactSignals: ['policy'],
    });

    expect(reason).toBeNull();
  });

  it('still hard-excludes opinion column content', () => {
    const reason = service.getSkipReason({
      title: 'AI 규제 칼럼',
      summary: '전문가 의견',
      link: 'https://example.com/news/2',
      ageHours: 1,
      impactSignals: ['policy'],
    });

    expect(reason).toBe('hard_excluded_keyword');
  });

  it('converts raw importance to 0.5-step display score', () => {
    expect(service.rawToDisplayImportance(0)).toBe(1.0);
    expect(service.rawToDisplayImportance(50)).toBe(3.0);
    expect(service.rawToDisplayImportance(63)).toBe(3.5);
    expect(service.rawToDisplayImportance(100)).toBe(5.0);
  });

  it('infers raw and display importance together', () => {
    const candidate = {
      title: '속보: 대미 수출통제 확대',
      link: 'https://example.com/news',
      summary: '수출통제와 제재가 반도체 공급망에 영향',
      topic: '글로벌_정세',
      sourceName: 'Reuters',
      sourceRaw: 'Reuters',
      publishedAt: '2026-02-18T00:00:00.000+09:00',
      ageHours: 2,
      impactSignals: ['policy', 'sanctions'] as const,
      score: 1,
      dedupeKey: 'x',
      clusterKey: 'x',
      readTimeSec: 40,
      matchedTo: null,
      isBreaking: true,
    };

    const raw = service.inferImportanceRaw(candidate);
    const display = service.inferImportance(candidate);

    expect(raw).toBeGreaterThan(0);
    expect(raw).toBeLessThanOrEqual(100);
    expect(display).toBeGreaterThanOrEqual(1);
    expect(display).toBeLessThanOrEqual(5);
    expect(Number.isInteger(display * 2)).toBe(true);
  });
});
