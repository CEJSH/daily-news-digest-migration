import { DigestGeneratorService } from './digest-generator.service';
import { formatDateYYYYMMDD, getKstNow } from '../utils/date.util';
import {
  CandidateItem,
  DailyDigest,
  DigestItem,
  DigestMetrics,
} from '../types/digest.types';

const buildCandidate = (overrides: Partial<CandidateItem>): CandidateItem =>
  ({
    title: '기사 제목',
    link: 'https://example.com/news',
    summary: '기사 요약',
    topic: '경제',
    sourceName: '연합뉴스',
    sourceRaw: '연합뉴스',
    publishedAt: '2026-02-17T00:00:00.000+09:00',
    ageHours: 1,
    impactSignals: [],
    score: 1,
    dedupeKey: 'base-key',
    clusterKey: 'base-cluster',
    readTimeSec: 30,
    matchedTo: null,
    ...overrides,
  }) as CandidateItem;

const buildDigestItem = (overrides: Partial<DigestItem>): DigestItem =>
  ({
    id: '2026-02-17_1',
    date: '2026-02-17',
    category: '정책',
    title: '속보 관세 협상 진전',
    summary: ['협상 진전 소식'],
    whyImportant: '정책 변화 시그널',
    importanceRationale: '근거: 정책 영향',
    impactSignals: [{ label: 'policy', evidence: '협상 진전 발표' }],
    dedupeKey: 'k1',
    clusterKey: 'c1',
    matchedTo: null,
    sourceName: '연합뉴스',
    sourceUrl: 'https://example.com/a',
    publishedAt: '2026-02-17T00:00:00.000+09:00',
    readTimeSec: 30,
    status: 'kept',
    importance: 3,
    qualityLabel: 'ok',
    qualityReason: '정보성 기사',
    isBriefing: false,
    isBreaking: true,
    ...overrides,
  }) as DigestItem;

describe('DigestGeneratorService', () => {
  it('reuses same-day partial digest when forceRegenerate is false', async () => {
    const today = formatDateYYYYMMDD(getKstNow());
    const partial: DailyDigest = {
      date: today,
      selectionCriteria: 'test',
      editorNote: 'test',
      question: 'test',
      lastUpdatedAt: '2026-02-16T00:00:00.000+09:00',
      items: [{ id: 'x' } as never],
    };

    const rssFeedService = { fetch: jest.fn() };
    const dedupeService = {};
    const scoringService = {};
    const storageService = {
      loadDigest: jest.fn().mockResolvedValue(partial),
    };
    const digestAiService = {};
    const digestValidationService = {};

    const service = new DigestGeneratorService(
      rssFeedService as never,
      dedupeService as never,
      scoringService as never,
      storageService as never,
      digestAiService as never,
      digestValidationService as never,
    );

    const result = await service.generateDigest();

    expect(result).toBe(partial);
    expect(rssFeedService.fetch).not.toHaveBeenCalled();
  });

  it('deduplicates in-flight generation for same request key', async () => {
    const digest: DailyDigest = {
      date: formatDateYYYYMMDD(getKstNow()),
      selectionCriteria: 'test',
      editorNote: 'test',
      question: 'test',
      lastUpdatedAt: '2026-02-16T00:00:00.000+09:00',
      items: [],
    };

    const service = new DigestGeneratorService(
      { fetch: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const coreSpy = jest
      .spyOn(service as any, 'generateDigestCore')
      .mockImplementation(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        return digest;
      });

    const [a, b] = await Promise.all([
      service.generateDigest({ topLimit: 12, forceRegenerate: true }),
      service.generateDigest({ topLimit: 12, forceRegenerate: true }),
    ]);

    expect(coreSpy).toHaveBeenCalledTimes(1);
    expect(a).toBe(digest);
    expect(b).toBe(digest);
  });

  it('clamps existing same-day digest to requested topLimit', async () => {
    const today = formatDateYYYYMMDD(getKstNow());
    const existing: DailyDigest = {
      date: today,
      selectionCriteria: 'test',
      editorNote: 'test',
      question: 'test',
      lastUpdatedAt: '2026-02-16T00:00:00.000+09:00',
      items: [{ id: '1' } as never, { id: '2' } as never, { id: '3' } as never],
    };

    const service = new DigestGeneratorService(
      { fetch: jest.fn() } as never,
      {} as never,
      {} as never,
      { loadDigest: jest.fn().mockResolvedValue(existing) } as never,
      {} as never,
      {} as never,
    );

    const result = await service.generateDigest({ topLimit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('1');
    expect(result.items[1].id).toBe('2');
  });

  it('reserves breaking slots when breaking candidates exist', () => {
    const dedupeService = {
      pickTopWithDiversity: jest
        .fn()
        .mockImplementation((items: CandidateItem[], limit: number) =>
          [...items].sort((a, b) => b.score - a.score).slice(0, limit),
        ),
    };

    const service = new DigestGeneratorService(
      {} as never,
      dedupeService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const serviceWithPrivate = service as unknown as {
      selectTopWithBreakingSlots: (
        allItems: CandidateItem[],
        limit: number,
      ) => CandidateItem[];
    };

    const selected = serviceWithPrivate.selectTopWithBreakingSlots(
      [
        buildCandidate({
          dedupeKey: 'a',
          clusterKey: 'a',
          score: 10,
          sourceName: 'A',
          sourceRaw: 'A',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'b',
          clusterKey: 'b',
          score: 9,
          sourceName: 'B',
          sourceRaw: 'B',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'c',
          clusterKey: 'c',
          score: 8,
          sourceName: 'C',
          sourceRaw: 'C',
          isBreaking: true,
        }),
      ],
      2,
    );

    expect(selected).toHaveLength(2);
    expect(selected.some((item) => item.isBreaking)).toBe(true);
  });

  it('rebalances categories even when breaking candidates are absent', () => {
    const dedupeService = {
      pickTopWithDiversity: jest
        .fn()
        .mockImplementation((items: CandidateItem[], limit: number) =>
          [...items].sort((a, b) => b.score - a.score).slice(0, limit),
        ),
    };

    const service = new DigestGeneratorService(
      {} as never,
      dedupeService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const serviceWithPrivate = service as unknown as {
      selectTopWithBreakingSlots: (
        allItems: CandidateItem[],
        limit: number,
      ) => CandidateItem[];
      inferCandidateCategory: (candidate: CandidateItem) => string;
    };

    const selected = serviceWithPrivate.selectTopWithBreakingSlots(
      [
        buildCandidate({
          dedupeKey: 'p1',
          clusterKey: 'p1',
          score: 100,
          topic: '국내_정책_규제',
          title: '국회 AI 규제 법안 통과',
          aiCategory: '정책',
          sourceName: 'A',
          sourceRaw: 'A',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'p2',
          clusterKey: 'p2',
          score: 99,
          topic: '국내_정책_규제',
          title: '금융위원회 생성형 AI 가이드라인 발표',
          aiCategory: '정책',
          sourceName: 'B',
          sourceRaw: 'B',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'p3',
          clusterKey: 'p3',
          score: 98,
          topic: '국내_정책_규제',
          title: '과기정통부 신규 규제안 예고',
          aiCategory: '정책',
          sourceName: 'C',
          sourceRaw: 'C',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'p4',
          clusterKey: 'p4',
          score: 97,
          topic: '국내_정책_규제',
          title: '국회 데이터법 개정 논의',
          aiCategory: '정책',
          sourceName: 'D',
          sourceRaw: 'D',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'p5',
          clusterKey: 'p5',
          score: 96,
          topic: '국내_정책_규제',
          title: '정부 플랫폼 규제 추진',
          aiCategory: '정책',
          sourceName: 'E',
          sourceRaw: 'E',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'p6',
          clusterKey: 'p6',
          score: 95,
          topic: '국내_정책_규제',
          title: '서울시 AI 안전 기준 발표',
          aiCategory: '정책',
          sourceName: 'F',
          sourceRaw: 'F',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 't1',
          clusterKey: 't1',
          score: 94,
          topic: 'IT',
          title: '엔비디아 신규 GPU 공개',
          aiCategory: '기술',
          sourceName: 'G',
          sourceRaw: 'G',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'e1',
          clusterKey: 'e1',
          score: 93,
          topic: '경제',
          title: '미국 CPI 상승',
          aiCategory: '경제',
          sourceName: 'H',
          sourceRaw: 'H',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'i1',
          clusterKey: 'i1',
          score: 92,
          topic: '글로벌_정세',
          title: '트럼프, 이란 협상 결렬 시 강경 대응 시사',
          aiCategory: '정책',
          sourceName: 'I',
          sourceRaw: 'I',
          isBreaking: false,
        }),
        buildCandidate({
          dedupeKey: 'i2',
          clusterKey: 'i2',
          score: 91,
          topic: '글로벌_정세',
          title: 'EU, 중동 긴장 고조에 긴급 외교 회의 개최',
          aiCategory: '정책',
          sourceName: 'J',
          sourceRaw: 'J',
          isBreaking: false,
        }),
      ],
      8,
    );

    const categories = selected.map((item) =>
      serviceWithPrivate.inferCandidateCategory(item),
    );
    const policyCount = categories.filter(
      (category) => category === '정책',
    ).length;
    const internationalCount = categories.filter(
      (category) => category === '국제',
    ).length;

    expect(selected).toHaveLength(8);
    expect(internationalCount).toBeGreaterThanOrEqual(1);
    expect(policyCount).toBeLessThan(6);
  });

  it('balances four core buckets and keeps tech+energy one item higher when feasible', () => {
    const dedupeService = {
      pickTopWithDiversity: jest
        .fn()
        .mockImplementation((items: CandidateItem[], limit: number) =>
          [...items].sort((a, b) => b.score - a.score).slice(0, limit),
        ),
    };

    const service = new DigestGeneratorService(
      {} as never,
      dedupeService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const serviceWithPrivate = service as unknown as {
      selectTopWithBreakingSlots: (
        allItems: CandidateItem[],
        limit: number,
      ) => CandidateItem[];
      inferBalanceBucket: (candidate: CandidateItem) => string;
    };

    const candidates: CandidateItem[] = [];
    for (let i = 0; i < 8; i += 1) {
      candidates.push(
        buildCandidate({
          dedupeKey: `p-${i}`,
          clusterKey: `p-${i}`,
          score: 200 - i,
          topic: '국내_정책_규제',
          aiCategory: '정책',
          title: `정책 뉴스 ${i}`,
          sourceName: `policy-${i}`,
          sourceRaw: `policy-${i}`,
          isBreaking: false,
        }),
      );
      candidates.push(
        buildCandidate({
          dedupeKey: `e-${i}`,
          clusterKey: `e-${i}`,
          score: 160 - i,
          topic: '경제',
          aiCategory: '경제',
          title: `경제 뉴스 ${i}`,
          sourceName: `economy-${i}`,
          sourceRaw: `economy-${i}`,
          isBreaking: false,
        }),
      );
      candidates.push(
        buildCandidate({
          dedupeKey: `i-${i}`,
          clusterKey: `i-${i}`,
          score: 130 - i,
          topic: '글로벌_정세',
          aiCategory: '국제',
          title: `국제 뉴스 ${i}`,
          sourceName: `international-${i}`,
          sourceRaw: `international-${i}`,
          isBreaking: false,
        }),
      );
      candidates.push(
        buildCandidate({
          dedupeKey: `t-${i}`,
          clusterKey: `t-${i}`,
          score: 100 - i,
          topic: 'IT',
          aiCategory: '기술',
          title: `기술 뉴스 ${i}`,
          sourceName: `tech-${i}`,
          sourceRaw: `tech-${i}`,
          isBreaking: false,
        }),
      );
      candidates.push(
        buildCandidate({
          dedupeKey: `en-${i}`,
          clusterKey: `en-${i}`,
          score: 90 - i,
          topic: '전력_인프라',
          aiCategory: '에너지',
          title: `에너지 뉴스 ${i}`,
          sourceName: `energy-${i}`,
          sourceRaw: `energy-${i}`,
          isBreaking: false,
        }),
      );
    }

    const selected = serviceWithPrivate.selectTopWithBreakingSlots(
      candidates,
      17,
    );
    const bucketCounts: Record<string, number> = {};
    for (const item of selected) {
      const bucket = serviceWithPrivate.inferBalanceBucket(item);
      bucketCounts[bucket] = (bucketCounts[bucket] ?? 0) + 1;
    }

    expect(selected).toHaveLength(17);
    expect(bucketCounts['정책']).toBe(4);
    expect(bucketCounts['경제']).toBe(4);
    expect(bucketCounts['국제']).toBe(4);
    expect(bucketCounts['기술']).toBe(5);
  });

  it('builds observability metrics for topic/source/breaking', () => {
    const service = new DigestGeneratorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const serviceWithPrivate = service as unknown as {
      buildTopicStats: (
        topicInCounts: Record<string, number>,
        selected: CandidateItem[],
        finalItems: DigestItem[],
      ) => Record<string, { in: number; out: number; dropped: number }>;
      buildBreakingSelectionStats: (
        candidatePool: CandidateItem[],
        finalItems: DigestItem[],
      ) => {
        candidates: number;
        selected: number;
        selectionRate: number;
        selectedShare: number;
      };
      buildMetrics: (
        digest: DailyDigest,
        totalIn: number,
        skipReasons: Record<string, number>,
        validationDropReasons?: Record<string, number>,
        topicStats?: Record<
          string,
          { in: number; out: number; dropped: number }
        >,
        sourceDropReasons?: Record<string, Record<string, number>>,
        breakingSelection?: {
          candidates: number;
          selected: number;
          selectionRate: number;
          selectedShare: number;
        },
      ) => DigestMetrics;
    };

    const selected = [
      buildCandidate({
        topic: 'IT',
        sourceName: '연합뉴스',
        sourceRaw: '연합뉴스',
        link: 'https://example.com/a',
        isBreaking: true,
      }),
      buildCandidate({
        topic: '경제',
        sourceName: 'Reuters',
        sourceRaw: 'Reuters',
        link: 'https://example.com/b',
        dedupeKey: 'k2',
        clusterKey: 'c2',
        isBreaking: false,
      }),
    ];
    const finalItems = [buildDigestItem()];
    const topicStats = serviceWithPrivate.buildTopicStats(
      { IT: 4, 경제: 3 },
      selected,
      finalItems,
    );
    const breakingSelection = serviceWithPrivate.buildBreakingSelectionStats(
      selected,
      finalItems,
    );

    const digest: DailyDigest = {
      date: '2026-02-17',
      selectionCriteria: 'test',
      editorNote: 'test',
      question: 'test',
      lastUpdatedAt: '2026-02-17T00:00:00.000+09:00',
      items: finalItems,
    };
    const metrics = serviceWithPrivate.buildMetrics(
      digest,
      7,
      { hard_excluded_keyword: 2 },
      { duplicate: 1 },
      topicStats,
      { Reuters: { not_selected: 1 } },
      breakingSelection,
    );

    expect(metrics.topicStats?.IT).toEqual({ in: 4, out: 1, dropped: 3 });
    expect(metrics.topicStats?.경제).toEqual({ in: 3, out: 0, dropped: 3 });
    expect(metrics.sourceDropReasons?.Reuters?.not_selected).toBe(1);
    expect(metrics.breakingSelection?.candidates).toBe(1);
    expect(metrics.breakingSelection?.selected).toBe(1);
    expect(metrics.breakingSelection?.selectionRate).toBe(1);
    expect(metrics.breakingSelection?.selectedShare).toBe(1);
  });

  it('compresses sourceDropReasons not_selected to top N and aggregates others', () => {
    const service = new DigestGeneratorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const serviceWithPrivate = service as unknown as {
      compressSourceDropReasons: (
        sourceDropReasons?: Record<string, Record<string, number>>,
        notSelectedTopN?: number,
      ) => Record<string, Record<string, number>> | undefined;
    };

    const compressed = serviceWithPrivate.compressSourceDropReasons(
      {
        A: { not_selected: 8, outdated: 1 },
        B: { not_selected: 5 },
        C: { not_selected: 2, duplicate_title: 1 },
      },
      1,
    );

    expect(compressed?.A?.not_selected).toBe(8);
    expect(compressed?.A?.outdated).toBe(1);
    expect(compressed?.C?.duplicate_title).toBe(1);
    expect(compressed?.B?.not_selected).toBeUndefined();
    expect(compressed?.C?.not_selected).toBeUndefined();
    expect(compressed?.__others__?.not_selected).toBe(7);
  });
});
