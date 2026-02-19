import { Injectable } from '@nestjs/common';
import {
  BREAKING_SCORE_BOOST,
  EXCLUDE_KEYWORDS,
  HARD_EXCLUDE_KEYWORDS,
  HARD_EXCLUDE_URL_HINTS,
  IMPACT_SIGNAL_BASE_LEVELS,
  IMPACT_SIGNALS_MAP,
  LONG_IMPACT_SIGNALS,
  SOURCE_TIER_A,
  SOURCE_TIER_B,
  TOP_FRESH_EXCEPT_MAX_HOURS,
  TOP_FRESH_EXCEPT_SIGNALS,
  TOP_FRESH_MAX_HOURS,
} from '../config/digest.constants';
import { CandidateItem, ImpactSignalLabel } from '../types/digest.types';
import { normalizeSourceName } from '../utils/text.util';

const TIER_A_NORM = new Set(
  [...SOURCE_TIER_A].map((source) => normalizeSourceName(source).toLowerCase()),
);
const TIER_B_NORM = new Set(
  [...SOURCE_TIER_B].map((source) => normalizeSourceName(source).toLowerCase()),
);
const BREAKING_TERMS = ['속보', 'breaking', 'just in', 'developing', '긴급'];
const CONTEXTUAL_HARD_EXCLUDE_KEYWORDS = new Set([
  '동향',
  '동향리포트',
  '리포트',
  'report',
]);
const CONTEXTUAL_HARD_EXCLUDE_URL_HINTS = new Set(['/report']);
const CONTEXTUAL_HARD_EXCLUDE_MAX_HOURS = 96;
const MACRO_EVENT_KEYWORDS = [
  '고용',
  '실업률',
  '물가',
  'cpi',
  'ppi',
  'pce',
  '기준금리',
  '금리',
  '환율',
  '관세',
  '무역',
  '협상',
  '제재',
  '실적',
  '가이던스',
  '매출',
  '영업이익',
];
const CONTEXTUAL_BYPASS_SIGNALS = new Set<ImpactSignalLabel>([
  'policy',
  'sanctions',
  'capex',
  'infra',
  'earnings',
  'market-demand',
]);

@Injectable()
export class DigestScoringService {
  isBreakingNews(params: { title: string; summary: string }): boolean {
    const title = (params.title || '').toLowerCase();
    const summary = (params.summary || '').toLowerCase();
    const merged = `${title} ${summary}`;

    return BREAKING_TERMS.some((term) => merged.includes(term));
  }

  getImpactSignals(text: string): ImpactSignalLabel[] {
    const normalized = (text || '').toLowerCase();
    const labels: ImpactSignalLabel[] = [];

    (Object.keys(IMPACT_SIGNALS_MAP) as ImpactSignalLabel[]).forEach(
      (label) => {
        const keywords = IMPACT_SIGNALS_MAP[label];
        if (
          keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))
        ) {
          labels.push(label);
        }
      },
    );

    const priority: ImpactSignalLabel[] = [
      'policy',
      'sanctions',
      'capex',
      'infra',
      'security',
      'earnings',
      'market-demand',
    ];

    return priority.filter((label) => labels.includes(label)).slice(0, 2);
  }

  mapTopicToCategory(topic: string): string {
    const t = (topic || '').toLowerCase();
    if (!t) {
      return '국제';
    }

    if (
      t.includes('정책') ||
      t.includes('규제') ||
      t.includes('입법') ||
      t.includes('국회') ||
      t.includes('관세') ||
      t.includes('무역') ||
      t.includes('협상') ||
      t.includes('제재')
    ) {
      return '정책';
    }
    if (
      t.includes('빅테크') ||
      t.startsWith('it') ||
      t.includes('tech') ||
      t.includes('ai')
    ) {
      return '기술';
    }
    if (
      t.includes('에너지') ||
      t.includes('전력') ||
      t.includes('원전') ||
      t.includes('lng')
    ) {
      return '에너지';
    }
    if (
      t.includes('금융') ||
      t.includes('금리') ||
      t.includes('환율') ||
      t.includes('ipo') ||
      t.includes('m&a') ||
      t.includes('투자') ||
      t.includes('실적')
    ) {
      return '금융';
    }
    if (t.includes('경제') || t.includes('물가') || t.includes('고용')) {
      return '경제';
    }
    if (t.includes('반도체') || t.includes('공급망') || t.includes('산업')) {
      return '산업';
    }
    if (t.includes('글로벌') || t.includes('정세')) {
      return '국제';
    }
    return '국제';
  }

  isFreshEnough(
    ageHours: number | null,
    impactSignals: ImpactSignalLabel[],
  ): boolean {
    if (ageHours == null) {
      return true;
    }
    if (ageHours <= TOP_FRESH_MAX_HOURS) {
      return true;
    }
    const hasExceptSignal = impactSignals.some(
      (label) =>
        TOP_FRESH_EXCEPT_SIGNALS.has(label) || LONG_IMPACT_SIGNALS.has(label),
    );
    return hasExceptSignal && ageHours <= TOP_FRESH_EXCEPT_MAX_HOURS;
  }

  getSkipReason(candidate: {
    title: string;
    summary: string;
    link: string;
    ageHours: number | null;
    impactSignals: ImpactSignalLabel[];
  }): string | null {
    const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
    const link = (candidate.link || '').toLowerCase();

    const hardKeywordHit = HARD_EXCLUDE_KEYWORDS.some((keyword) =>
      text.includes(keyword.toLowerCase()),
    );
    const hardUrlHit = HARD_EXCLUDE_URL_HINTS.some((hint) =>
      link.includes(hint),
    );
    if (
      (hardKeywordHit || hardUrlHit) &&
      this.shouldHardExclude({
        title: candidate.title,
        summary: candidate.summary,
        link: candidate.link,
        ageHours: candidate.ageHours,
        impactSignals: candidate.impactSignals,
      })
    ) {
      return hardKeywordHit ? 'hard_excluded_keyword' : 'hard_excluded_url';
    }
    if (
      EXCLUDE_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))
    ) {
      return 'excluded_keyword';
    }
    if (candidate.ageHours == null) {
      return 'missing_published_at';
    }
    if (!this.isFreshEnough(candidate.ageHours, candidate.impactSignals)) {
      return 'outdated';
    }
    return null;
  }

  private shouldHardExclude(candidate: {
    title: string;
    summary: string;
    link: string;
    ageHours: number | null;
    impactSignals: ImpactSignalLabel[];
  }): boolean {
    const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
    const link = (candidate.link || '').toLowerCase();

    const strictKeywordHit = HARD_EXCLUDE_KEYWORDS.some((keyword) => {
      const normalized = keyword.toLowerCase();
      return (
        !CONTEXTUAL_HARD_EXCLUDE_KEYWORDS.has(normalized) &&
        text.includes(normalized)
      );
    });
    if (strictKeywordHit) {
      return true;
    }

    const strictUrlHit = HARD_EXCLUDE_URL_HINTS.some((hint) => {
      return (
        !CONTEXTUAL_HARD_EXCLUDE_URL_HINTS.has(hint) && link.includes(hint)
      );
    });
    if (strictUrlHit) {
      return true;
    }

    const contextualKeywordHit = HARD_EXCLUDE_KEYWORDS.some((keyword) => {
      return (
        CONTEXTUAL_HARD_EXCLUDE_KEYWORDS.has(keyword.toLowerCase()) &&
        text.includes(keyword.toLowerCase())
      );
    });
    const contextualUrlHit = HARD_EXCLUDE_URL_HINTS.some((hint) => {
      return CONTEXTUAL_HARD_EXCLUDE_URL_HINTS.has(hint) && link.includes(hint);
    });
    if (!contextualKeywordHit && !contextualUrlHit) {
      return false;
    }

    if (
      this.isBreakingNews({
        title: candidate.title,
        summary: candidate.summary,
      })
    ) {
      return false;
    }

    if (
      candidate.ageHours != null &&
      candidate.ageHours > CONTEXTUAL_HARD_EXCLUDE_MAX_HOURS
    ) {
      return true;
    }

    const hasStrongSignal = candidate.impactSignals.some((label) =>
      CONTEXTUAL_BYPASS_SIGNALS.has(label),
    );
    if (hasStrongSignal) {
      return false;
    }

    const hasMacroContext = MACRO_EVENT_KEYWORDS.some((keyword) =>
      text.includes(keyword.toLowerCase()),
    );
    if (hasMacroContext) {
      return false;
    }

    return true;
  }

  scoreItem(params: {
    impactSignals: ImpactSignalLabel[];
    readTimeSec: number;
    sourceName: string;
    ageHours: number | null;
    isBreaking?: boolean;
  }): number {
    const signalScore = params.impactSignals.reduce(
      (sum, label) => sum + (IMPACT_SIGNAL_BASE_LEVELS[label] ?? 1),
      0,
    );

    const sourceWeight = this.sourceWeight(params.sourceName);
    const freshnessBoost =
      params.ageHours == null
        ? 0.2
        : Math.max(0, (72 - Math.min(params.ageHours, 72)) / 72);
    const readabilityBoost = params.readTimeSec <= 70 ? 0.3 : 0.1;
    const breakingBoost = params.isBreaking ? BREAKING_SCORE_BOOST : 0;

    const total =
      signalScore +
      sourceWeight +
      freshnessBoost +
      readabilityBoost +
      breakingBoost;
    return Number(total.toFixed(4));
  }

  inferImportance(candidate: CandidateItem): number {
    const raw = this.inferImportanceRaw(candidate);
    return this.rawToDisplayImportance(raw);
  }

  inferImportanceRaw(candidate: CandidateItem): number {
    const signalLevel = candidate.impactSignals.reduce(
      (acc, label) => Math.max(acc, IMPACT_SIGNAL_BASE_LEVELS[label] ?? 1),
      1,
    );
    const signalRaw = ((signalLevel - 1) / 3) * 45;
    const multiSignalBonus = candidate.impactSignals.length >= 2 ? 5 : 0;

    const sourceWeight = this.sourceWeight(candidate.sourceName);
    const sourceRaw = sourceWeight >= 1.5 ? 22 : sourceWeight >= 0.8 ? 14 : 8;

    const freshnessWindow = Math.max(24, Math.min(120, TOP_FRESH_MAX_HOURS));
    const freshnessRaw =
      candidate.ageHours == null
        ? 12
        : Math.max(
            0,
            (1 -
              Math.min(candidate.ageHours, freshnessWindow) / freshnessWindow) *
              18,
          );
    const breakingRaw = candidate.isBreaking ? 10 : 0;
    const readabilityRaw = candidate.readTimeSec <= 70 ? 5 : 2;

    const total =
      signalRaw +
      multiSignalBonus +
      sourceRaw +
      freshnessRaw +
      breakingRaw +
      readabilityRaw;
    return Math.max(0, Math.min(100, Math.round(total)));
  }

  rawToDisplayImportance(raw: number): number {
    const safeRaw = Number.isFinite(raw) ? raw : 0;
    const clamped = Math.max(0, Math.min(100, safeRaw));
    const scaled = 1 + (clamped / 100) * 4;
    return this.normalizeDisplayImportance(scaled);
  }

  displayToRawImportance(display: number): number {
    const normalized = this.normalizeDisplayImportance(display);
    return Math.max(0, Math.min(100, Math.round(((normalized - 1) / 4) * 100)));
  }

  normalizeDisplayImportance(value: number): number {
    const safe = Number.isFinite(value) ? value : 1;
    const clamped = Math.max(1, Math.min(5, safe));
    return Number((Math.round(clamped * 2) / 2).toFixed(1));
  }

  private sourceWeight(sourceName: string): number {
    const normalized = normalizeSourceName(sourceName || '').toLowerCase();
    if (SOURCE_TIER_A.has(sourceName) || TIER_A_NORM.has(normalized)) {
      return 1.6;
    }
    if (SOURCE_TIER_B.has(sourceName) || TIER_B_NORM.has(normalized)) {
      return 0.8;
    }
    return 0.2;
  }
}
