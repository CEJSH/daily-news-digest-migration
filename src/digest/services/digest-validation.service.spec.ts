import { DailyDigest, DigestItem } from '../types/digest.types';
import { DigestValidationService } from './digest-validation.service';

function makeItem(overrides: Partial<DigestItem>): DigestItem {
  const nowIso = new Date().toISOString();
  return {
    id: '2026-02-16_1',
    date: nowIso.slice(0, 10),
    category: '정책',
    title: '기본 제목',
    summary: ['기본 요약'],
    whyImportant: '중요합니다.',
    importanceRationale: '근거: 테스트',
    impactSignals: [],
    dedupeKey: '기본-키',
    clusterKey: '기본/클러스터',
    matchedTo: null,
    sourceName: 'Reuters',
    sourceUrl: 'https://example.com/a',
    publishedAt: nowIso,
    readTimeSec: 30,
    status: 'kept',
    importance: 2,
    qualityLabel: 'ok',
    qualityReason: '정보성 기사',
    isBriefing: false,
    ...overrides,
  };
}

function makeDigest(items: DigestItem[]): DailyDigest {
  const nowIso = new Date().toISOString();
  return {
    date: nowIso.slice(0, 10),
    selectionCriteria: 'test',
    editorNote: 'test',
    question: 'test',
    lastUpdatedAt: nowIso,
    items,
  };
}

describe('DigestValidationService near-duplicate dedupe', () => {
  let service: DigestValidationService;

  beforeEach(() => {
    service = new DigestValidationService();
  });

  it('drops near-duplicate items even when dedupeKey differs', () => {
    const a = makeItem({
      id: '2026-02-16_1',
      title: '미국, 중국 대상 반도체 장비 수출 통제 강화 검토',
      summary: [
        '미국 정부가 중국으로 향하는 반도체 장비 수출 통제를 강화하는 방안을 검토 중이다.',
      ],
      dedupeKey: '미국-중국-반도체-장비-수출-통제-강화',
      sourceName: 'Reuters',
      sourceUrl: 'https://news.example.com/a',
    });

    const b = makeItem({
      id: '2026-02-16_2',
      title: '美 정부, 대중 반도체 장비 수출 규제 강화 추진',
      summary: [
        '미국 정부는 중국향 반도체 장비 수출 규제를 강화하는 정책을 추진하고 있다.',
      ],
      dedupeKey: '대중-반도체-수출-규제-미국-정부-정책',
      sourceName: 'Random Tech Media',
      sourceUrl: 'https://news.example.com/b',
    });

    const normalized = service.normalizeDigest(makeDigest([a, b]));
    const stats = service.getLastNormalizationStats();

    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0].sourceName).toBe('Reuters');
    expect(stats.dropReasons.duplicate_similarity).toBe(1);
  });

  it('keeps distinct items', () => {
    const a = makeItem({
      id: '2026-02-16_1',
      title: '유럽, AI 반도체 투자 확대 발표',
      summary: ['유럽 주요국이 AI 반도체 생산시설 투자 확대 계획을 발표했다.'],
      dedupeKey: '유럽-ai-반도체-투자-확대',
      sourceUrl: 'https://news.example.com/c',
    });
    const b = makeItem({
      id: '2026-02-16_2',
      title: '미국 병원 대상 랜섬웨어 공격 증가',
      summary: ['미국 의료기관 대상 랜섬웨어 공격이 최근 급증했다.'],
      dedupeKey: '미국-병원-랜섬웨어-공격',
      sourceUrl: 'https://news.example.com/d',
      category: '국제',
    });

    const normalized = service.normalizeDigest(makeDigest([a, b]));

    expect(normalized.items).toHaveLength(2);
  });
});
