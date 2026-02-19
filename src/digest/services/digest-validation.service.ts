import { Injectable } from '@nestjs/common';
import {
  ALLOWED_IMPACT_LABELS,
  CAPEX_ACTION_KEYWORDS,
  CAPEX_PLAN_KEYWORDS,
  EARNINGS_METRIC_KEYWORDS,
  INFRA_KEYWORDS,
  INCIDENT_CONTEXT_KEYWORDS,
  LOW_QUALITY_DOWNGRADE_MAX_IMPORTANCE,
  LOW_QUALITY_DOWNGRADE_RATIONALE,
  LOW_QUALITY_POLICY,
  MARKET_DEMAND_EVIDENCE_KEYWORDS,
  NON_EVENT_DATE_CONTEXT_KEYWORDS,
  POLICY_GOV_KEYWORDS,
  POLICY_NEGOTIATION_KEYWORDS,
  POLICY_STRONG_KEYWORDS,
  POLICY_TRADE_ONLY_KEYWORDS,
  SANCTIONS_EVIDENCE_KEYWORDS,
  SECURITY_EVIDENCE_KEYWORDS,
  STOPWORDS,
  SOURCE_TIER_A,
  SOURCE_TIER_B,
  STALE_EVENT_MAX_DAYS,
  STALE_INCIDENT_TOPICAL_KEYWORDS,
  MIN_TOP_ITEMS,
  TOP_FRESH_EXCEPT_MAX_HOURS,
  TOP_FRESH_EXCEPT_SIGNALS,
  TOP_FRESH_MAX_HOURS,
  TOP_LIMIT,
} from '../config/digest.constants';
import {
  DailyDigest,
  DigestItem,
  ImpactSignalLabel,
} from '../types/digest.types';
import { jaccard, ngramSet } from '../utils/similarity.util';
import {
  cleanText,
  normalizeSourceName,
  tokenizeForDedupe,
} from '../utils/text.util';

const NEAR_DUP_TITLE_JACCARD = Number(
  process.env.NEAR_DUP_TITLE_JACCARD ?? 0.74,
);
const NEAR_DUP_CONTENT_JACCARD = Number(
  process.env.NEAR_DUP_CONTENT_JACCARD ?? 0.68,
);
const NEAR_DUP_KEY_NGRAM = Number(process.env.NEAR_DUP_KEY_NGRAM ?? 0.66);

const EXPLICIT_DATE_PATTERNS = [
  /(?<year>(?:19|20)\d{2})\s*년\s*(?<month>1[0-2]|0?[1-9])\s*월\s*(?<day>3[01]|[12]?\d)\s*일?/g,
  /(?<year>(?:19|20)\d{2})\s*[./-]\s*(?<month>1[0-2]|0?[1-9])\s*[./-]\s*(?<day>3[01]|[12]?\d)/g,
];

const HARD_VALIDATION_ERRORS = new Set([
  'VALIDATION_ERROR: MISSING_FIELD',
  'ERROR: IMPACT_SIGNALS_REQUIRED',
  'ERROR: DUPLICATE_IMPACT_SIGNAL_LABEL',
  'ERROR: INVALID_POLICY_LABEL',
  'ERROR: INVALID_SANCTIONS_LABEL',
  'ERROR: INVALID_MARKET_DEMAND_LABEL',
  'ERROR: INVALID_EARNINGS_LABEL',
  'ERROR: INVALID_CAPEX_LABEL',
  'ERROR: INVALID_INFRA_LABEL',
  'ERROR: INVALID_SECURITY_LABEL',
  'ERROR: INVALID_IMPACT_LABEL',
  'ERROR: IMPACT_EVIDENCE_REQUIRED',
  'ERROR: IMPACT_EVIDENCE_TOO_SHORT',
  'ERROR: INVALID_IMPACT_SIGNAL_FORMAT',
  'ERROR: DUPLICATE_IMPACT_SIGNAL_EVIDENCE',
  'ERROR: LOW_QUALITY_MISMATCH',
  'ERROR: DUPLICATE_DEDUPE_KEY',
  'ERROR: OUTDATED_ITEM',
  'ERROR: STALE_INCIDENT_ITEM',
]);

interface NormalizationStats {
  beforeCount: number;
  afterCount: number;
  dropped: number;
  dropReasons: Record<string, number>;
  duplicateResolved: number;
}

@Injectable()
export class DigestValidationService {
  private lastNormalizationStats: NormalizationStats = {
    beforeCount: 0,
    afterCount: 0,
    dropped: 0,
    dropReasons: {},
    duplicateResolved: 0,
  };

  getLastNormalizationStats(): NormalizationStats {
    return {
      ...this.lastNormalizationStats,
      dropReasons: { ...this.lastNormalizationStats.dropReasons },
    };
  }

  normalizeDigest(digest: DailyDigest): DailyDigest {
    const date = cleanText(digest.date);
    const filtered: DigestItem[] = [];
    const dropReasons: Record<string, number> = {};
    const beforeCount = digest.items.length;
    const countDrop = (reason: string) => {
      const key = cleanText(reason || 'dropped') || 'dropped';
      dropReasons[key] = (dropReasons[key] ?? 0) + 1;
    };

    for (const item of digest.items) {
      const normalized = this.normalizeItem(item);

      if (normalized.status === 'dropped') {
        countDrop(normalized.dropReason || 'dropped');
        continue;
      }

      if (normalized.importance >= 3 && normalized.impactSignals.length === 0) {
        normalized.importance = 2;
        if (!normalized.qualityReason.includes('근거부족')) {
          normalized.qualityReason =
            normalized.qualityReason === '정보성 기사'
              ? '근거부족'
              : `${normalized.qualityReason} / 근거부족`;
        }
      }

      filtered.push(normalized);
    }

    const { items: dedupeResolved, duplicateResolved } =
      this.resolveDuplicateDedupeItems(filtered);
    if (duplicateResolved > 0) {
      dropReasons.duplicate = (dropReasons.duplicate ?? 0) + duplicateResolved;
    }
    const { items: nearDedupeResolved, nearDuplicateResolved } =
      this.resolveNearDuplicateItems(dedupeResolved);
    if (nearDuplicateResolved > 0) {
      dropReasons.duplicate_similarity =
        (dropReasons.duplicate_similarity ?? 0) + nearDuplicateResolved;
    }

    const resequenced = nearDedupeResolved.map((item, index) => ({
      ...item,
      id: `${date}_${index + 1}`,
    }));

    this.lastNormalizationStats = {
      beforeCount,
      afterCount: resequenced.length,
      dropped: Math.max(0, beforeCount - resequenced.length),
      dropReasons,
      duplicateResolved: duplicateResolved + nearDuplicateResolved,
    };

    return {
      ...digest,
      items: resequenced,
    };
  }

  validateDigest(digest: DailyDigest): { valid: boolean; error: string } {
    if (!digest || typeof digest !== 'object') {
      return { valid: false, error: 'INVALID_DIGEST' };
    }

    const items = Array.isArray(digest.items) ? digest.items : [];
    if (items.length < MIN_TOP_ITEMS || items.length > TOP_LIMIT) {
      return { valid: false, error: 'INVALID_DIGEST' };
    }

    if (this.hasDuplicateDedupeKey(items)) {
      return { valid: false, error: 'ERROR: DUPLICATE_DEDUPE_KEY' };
    }

    const required = new Set([
      'id',
      'date',
      'category',
      'title',
      'summary',
      'whyImportant',
      'importanceRationale',
      'impactSignals',
      'dedupeKey',
      'sourceName',
      'sourceUrl',
      'publishedAt',
      'status',
      'importance',
      'qualityLabel',
      'qualityReason',
    ]);

    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return { valid: false, error: 'INVALID_DIGEST' };
      }

      const missing = [...required].filter((key) => !(key in item));
      if (missing.length > 0) {
        return { valid: false, error: 'VALIDATION_ERROR: MISSING_FIELD' };
      }

      const outdated = this.isOutdatedItem(item);
      if (outdated && item.status !== 'dropped' && !item.isCarriedOver) {
        return { valid: false, error: 'ERROR: OUTDATED_ITEM' };
      }

      const summaryText = this.summaryText(item.summary);
      const stale = this.detectStaleIncident(
        item.date,
        `${item.title} ${summaryText}`,
      );
      if (stale && item.status !== 'dropped' && !item.isCarriedOver) {
        return { valid: false, error: 'ERROR: STALE_INCIDENT_ITEM' };
      }

      if (item.qualityLabel === 'low_quality') {
        if (item.status !== 'dropped' && !this.lowQualityExceptionOk(item)) {
          return { valid: false, error: 'ERROR: LOW_QUALITY_MISMATCH' };
        }
      }

      if (!Array.isArray(item.impactSignals)) {
        return { valid: false, error: 'ERROR: INVALID_IMPACT_SIGNAL_FORMAT' };
      }

      if (
        item.impactSignals.some((entry) => !entry || typeof entry !== 'object')
      ) {
        return { valid: false, error: 'ERROR: INVALID_IMPACT_SIGNAL_FORMAT' };
      }

      if (this.hasDuplicateImpactLabels(item.impactSignals)) {
        return { valid: false, error: 'ERROR: DUPLICATE_IMPACT_SIGNAL_LABEL' };
      }
      if (this.hasDuplicateImpactEvidence(item.impactSignals)) {
        return {
          valid: false,
          error: 'ERROR: DUPLICATE_IMPACT_SIGNAL_EVIDENCE',
        };
      }

      for (const [label, evidence] of this.iterImpactSignalEntries(
        item.impactSignals,
      )) {
        if (!ALLOWED_IMPACT_LABELS.has(label as ImpactSignalLabel)) {
          return { valid: false, error: 'ERROR: INVALID_IMPACT_LABEL' };
        }
        if (!evidence) {
          return { valid: false, error: 'ERROR: IMPACT_EVIDENCE_REQUIRED' };
        }
        if (this.isEvidenceTooShort(evidence)) {
          return { valid: false, error: 'ERROR: IMPACT_EVIDENCE_TOO_SHORT' };
        }

        if (label === 'policy' && !this.policyEvidenceValid(evidence)) {
          return { valid: false, error: 'ERROR: INVALID_POLICY_LABEL' };
        }
        if (label === 'sanctions' && !this.sanctionsEvidenceValid(evidence)) {
          return { valid: false, error: 'ERROR: INVALID_SANCTIONS_LABEL' };
        }
        if (
          label === 'market-demand' &&
          !this.marketDemandEvidenceValid(evidence)
        ) {
          return { valid: false, error: 'ERROR: INVALID_MARKET_DEMAND_LABEL' };
        }
        if (label === 'earnings' && !this.earningsEvidenceValid(evidence)) {
          return { valid: false, error: 'ERROR: INVALID_EARNINGS_LABEL' };
        }
        if (label === 'capex' && !this.capexEvidenceValid(evidence)) {
          return { valid: false, error: 'ERROR: INVALID_CAPEX_LABEL' };
        }
        if (label === 'infra' && !this.infraEvidenceValid(evidence)) {
          return { valid: false, error: 'ERROR: INVALID_INFRA_LABEL' };
        }
        if (label === 'security' && !this.securityEvidenceValid(evidence)) {
          return { valid: false, error: 'ERROR: INVALID_SECURITY_LABEL' };
        }
      }

      if (
        Number(item.importance ?? 0) >= 3 &&
        item.impactSignals.length === 0
      ) {
        return { valid: false, error: 'ERROR: IMPACT_SIGNALS_REQUIRED' };
      }

      if (!item.title || !item.sourceUrl) {
        return { valid: false, error: 'INVALID_DIGEST' };
      }
      if (!Array.isArray(item.summary) || item.summary.length === 0) {
        return { valid: false, error: 'INVALID_DIGEST' };
      }
    }

    return { valid: true, error: '' };
  }

  isHardValidationError(error: string): boolean {
    return HARD_VALIDATION_ERRORS.has(error);
  }

  private normalizeItem(item: DigestItem): DigestItem {
    const normalized: DigestItem = {
      ...item,
      title: cleanText(item.title),
      category: cleanText(item.category),
      dedupeKey: cleanText(item.dedupeKey),
      clusterKey: cleanText(item.clusterKey),
      sourceName: cleanText(item.sourceName),
      sourceUrl: cleanText(item.sourceUrl),
      publishedAt: cleanText(item.publishedAt),
      whyImportant: cleanText(item.whyImportant),
      importanceRationale: cleanText(item.importanceRationale),
      qualityReason: cleanText(item.qualityReason) || '정보성 기사',
      summary: (Array.isArray(item.summary) ? item.summary : [])
        .map((line) => cleanText(String(line)))
        .filter(Boolean)
        .slice(0, 3),
      impactSignals: this.sanitizeImpactSignals(item.impactSignals),
    };

    if (normalized.summary.length === 0) {
      normalized.summary = [normalized.title].filter(Boolean);
    }

    normalized.importance = this.normalizeDisplayImportance(
      Number(normalized.importance || 1),
    );
    const importanceRawParsed = Number(normalized.importanceRaw);
    if (Number.isFinite(importanceRawParsed)) {
      normalized.importanceRaw = Math.max(
        0,
        Math.min(100, Math.round(importanceRawParsed)),
      );
    } else {
      normalized.importanceRaw = this.displayToRawImportance(
        normalized.importance,
      );
    }

    if (this.isOutdatedItem(normalized) && !normalized.isCarriedOver) {
      normalized.status = 'dropped';
      normalized.dropReason = normalized.dropReason || 'outdated';
    }

    const incidentText = `${normalized.title} ${this.summaryText(normalized.summary)}`;
    if (
      this.detectStaleIncident(normalized.date, incidentText) &&
      !normalized.isCarriedOver
    ) {
      normalized.status = 'dropped';
      normalized.dropReason = normalized.dropReason || 'stale_incident';
    }

    if (
      normalized.qualityLabel === 'low_quality' &&
      normalized.status !== 'dropped'
    ) {
      if (LOW_QUALITY_POLICY === 'drop') {
        normalized.status = 'dropped';
        normalized.dropReason =
          normalized.dropReason || `ai_low_quality:${normalized.qualityReason}`;
      } else {
        normalized.importance = Math.min(
          normalized.importance,
          Math.max(0, LOW_QUALITY_DOWNGRADE_MAX_IMPORTANCE),
        );
        normalized.importance = this.normalizeDisplayImportance(
          normalized.importance,
        );
        normalized.importanceRaw = Math.min(
          normalized.importanceRaw ??
            this.displayToRawImportance(normalized.importance),
          this.displayToRawImportance(normalized.importance),
        );
        normalized.importanceRationale = `근거: ${LOW_QUALITY_DOWNGRADE_RATIONALE}`;
      }
    }

    if (!normalized.qualityReason) {
      normalized.qualityReason = '정보성 기사';
    }

    if (normalized.status === 'dropped') {
      normalized.qualityLabel = 'low_quality';
    }

    return normalized;
  }

  private normalizeDisplayImportance(value: number): number {
    const safe = Number.isFinite(value) ? value : 1;
    const clamped = Math.max(1, Math.min(5, safe));
    return Number((Math.round(clamped * 2) / 2).toFixed(1));
  }

  private displayToRawImportance(display: number): number {
    const normalized = this.normalizeDisplayImportance(display);
    return Math.max(0, Math.min(100, Math.round(((normalized - 1) / 4) * 100)));
  }

  private sanitizeImpactSignals(
    signals: DigestItem['impactSignals'],
  ): DigestItem['impactSignals'] {
    if (!Array.isArray(signals)) {
      return [];
    }

    const out: DigestItem['impactSignals'] = [];
    const seenLabel = new Set<string>();
    const seenEvidence = new Set<string>();

    for (const entry of signals) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const label = cleanText(entry.label || '').toLowerCase();
      const evidence = cleanText(entry.evidence || '');

      if (!ALLOWED_IMPACT_LABELS.has(label as ImpactSignalLabel)) {
        continue;
      }
      if (!evidence) {
        continue;
      }
      if (this.isEvidenceTooShort(evidence)) {
        continue;
      }
      if (!this.labelEvidenceValid(label, evidence)) {
        continue;
      }
      if (seenLabel.has(label)) {
        continue;
      }
      const evidenceKey = this.normalizeEvidenceKey(evidence);
      if (!evidenceKey || seenEvidence.has(evidenceKey)) {
        continue;
      }

      out.push({
        label: label as ImpactSignalLabel,
        evidence,
      });
      seenLabel.add(label);
      seenEvidence.add(evidenceKey);

      if (out.length >= 2) {
        break;
      }
    }

    return out;
  }

  private labelEvidenceValid(label: string, evidence: string): boolean {
    if (label === 'policy') {
      return this.policyEvidenceValid(evidence);
    }
    if (label === 'sanctions') {
      return this.sanctionsEvidenceValid(evidence);
    }
    if (label === 'market-demand') {
      return this.marketDemandEvidenceValid(evidence);
    }
    if (label === 'earnings') {
      return this.earningsEvidenceValid(evidence);
    }
    if (label === 'capex') {
      return this.capexEvidenceValid(evidence);
    }
    if (label === 'infra') {
      return this.infraEvidenceValid(evidence);
    }
    if (label === 'security') {
      return this.securityEvidenceValid(evidence);
    }
    return false;
  }

  private resolveDuplicateDedupeItems(items: DigestItem[]): {
    items: DigestItem[];
    duplicateResolved: number;
  } {
    const byKey = new Map<string, DigestItem[]>();
    for (const item of items) {
      const key = cleanText(item.dedupeKey);
      if (!key) {
        continue;
      }
      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key)?.push(item);
    }

    const kept: DigestItem[] = [];
    let duplicateResolved = 0;
    for (const group of byKey.values()) {
      if (group.length === 1) {
        kept.push(group[0]);
        continue;
      }

      const ranked = [...group].sort(
        (a, b) => this.itemRank(b) - this.itemRank(a),
      );
      const winner = ranked[0];
      kept.push(winner);
      duplicateResolved += Math.max(0, group.length - 1);
    }

    const noKeyItems = items.filter((item) => !cleanText(item.dedupeKey));
    return {
      items: [...kept, ...noKeyItems].filter(
        (item) => item.status !== 'dropped',
      ),
      duplicateResolved,
    };
  }

  private resolveNearDuplicateItems(items: DigestItem[]): {
    items: DigestItem[];
    nearDuplicateResolved: number;
  } {
    const kept: DigestItem[] = [];
    let nearDuplicateResolved = 0;

    for (const item of items) {
      const duplicateIndex = kept.findIndex((existing) =>
        this.isLikelyNearDuplicate(item, existing),
      );
      if (duplicateIndex < 0) {
        kept.push(item);
        continue;
      }

      nearDuplicateResolved += 1;
      const current = kept[duplicateIndex];
      if (this.itemRank(item) > this.itemRank(current)) {
        kept[duplicateIndex] = item;
      }
    }

    return {
      items: kept.filter((item) => item.status !== 'dropped'),
      nearDuplicateResolved,
    };
  }

  private isLikelyNearDuplicate(a: DigestItem, b: DigestItem): boolean {
    const keyA = cleanText(a.dedupeKey);
    const keyB = cleanText(b.dedupeKey);
    if (keyA && keyB && keyA === keyB) {
      return true;
    }

    const urlA = this.canonicalUrl(a.sourceUrl);
    const urlB = this.canonicalUrl(b.sourceUrl);
    if (urlA && urlB && urlA === urlB) {
      return true;
    }

    const titleA = cleanText(a.title).toLowerCase();
    const titleB = cleanText(b.title).toLowerCase();
    if (titleA && titleB && this.isTitleInclusionDuplicate(titleA, titleB)) {
      return true;
    }

    const titleSetA = this.tokenSet(titleA);
    const titleSetB = this.tokenSet(titleB);
    const titleOverlap = this.intersectionSize(titleSetA, titleSetB);
    const titleSimilarity = jaccard(titleSetA, titleSetB);
    const titleOverlapRatio = this.overlapRatio(
      titleSetA,
      titleSetB,
      titleOverlap,
    );

    const contentA = `${titleA} ${this.summaryText(a.summary)}`;
    const contentB = `${titleB} ${this.summaryText(b.summary)}`;
    const contentSetA = this.tokenSet(contentA);
    const contentSetB = this.tokenSet(contentB);
    const contentOverlap = this.intersectionSize(contentSetA, contentSetB);
    const contentSimilarity = jaccard(contentSetA, contentSetB);
    const contentOverlapRatio = this.overlapRatio(
      contentSetA,
      contentSetB,
      contentOverlap,
    );

    const keySimilarity =
      keyA && keyB ? jaccard(ngramSet(keyA, 2), ngramSet(keyB, 2)) : 0;

    if (titleSimilarity >= NEAR_DUP_TITLE_JACCARD && titleOverlap >= 4) {
      return true;
    }
    if (
      contentSimilarity >= NEAR_DUP_CONTENT_JACCARD &&
      contentOverlap >= 5 &&
      titleSimilarity >= 0.55
    ) {
      return true;
    }
    if (
      keySimilarity >= NEAR_DUP_KEY_NGRAM &&
      contentSimilarity >= 0.62 &&
      contentOverlap >= 5
    ) {
      return true;
    }
    if (
      titleOverlap >= 4 &&
      titleOverlapRatio >= 0.5 &&
      contentOverlap >= 5 &&
      contentOverlapRatio >= 0.5
    ) {
      return true;
    }

    return false;
  }

  private isTitleInclusionDuplicate(a: string, b: string): boolean {
    if (a.length < 28 || b.length < 28) {
      return false;
    }
    return a.includes(b) || b.includes(a);
  }

  private tokenSet(text: string): Set<string> {
    return new Set(this.normalizeSimilarityTokens(text));
  }

  private normalizeSimilarityTokens(text: string): string[] {
    const aliased = this.normalizeAliasText(text);
    return tokenizeForDedupe(aliased)
      .map((token) => this.canonicalizeToken(token.trim().toLowerCase()))
      .filter(Boolean)
      .filter((token) => token.length >= (/[가-힣]/.test(token) ? 2 : 3))
      .filter((token) => !STOPWORDS.has(token))
      .filter((token) => !/^\d+$/.test(token));
  }

  private normalizeAliasText(text: string): string {
    return cleanText(text || '')
      .replace(/美/g, '미국')
      .replace(/中/g, '중국')
      .replace(/日/g, '일본')
      .replace(/韓/g, '한국')
      .replace(/\b대중\b/g, '중국')
      .replace(/\b대미\b/g, '미국')
      .replace(/\b중국향\b/g, '중국')
      .replace(/\b미국향\b/g, '미국');
  }

  private canonicalizeToken(token: string): string {
    if (!token) {
      return '';
    }

    const aliasMap: Record<string, string> = {
      통제: '규제',
      통제를: '규제',
      통제가: '규제',
      통제는: '규제',
      대중: '중국',
      중국향: '중국',
      대미: '미국',
      미국향: '미국',
    };
    let out = aliasMap[token] ?? token;
    out = out.replace(/(은|는|이|가|을|를|에|의|도|와|과)$/u, '');
    out = out.replace(/(으로|에서)$/u, '');
    return out;
  }

  private intersectionSize(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) {
      return 0;
    }
    let hits = 0;
    for (const token of a) {
      if (b.has(token)) {
        hits += 1;
      }
    }
    return hits;
  }

  private overlapRatio(
    a: Set<string>,
    b: Set<string>,
    intersection: number,
  ): number {
    if (intersection <= 0 || a.size === 0 || b.size === 0) {
      return 0;
    }
    return intersection / Math.min(a.size, b.size);
  }

  private canonicalUrl(url: string): string {
    const cleaned = cleanText(url || '').trim();
    if (!cleaned) {
      return '';
    }

    try {
      const parsed = new URL(cleaned);
      const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
      const pathname = parsed.pathname.replace(/\/+$/, '');
      return `${host}${pathname}`;
    } catch {
      return cleaned
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split(/[?#]/)[0]
        .replace(/\/+$/, '')
        .toLowerCase();
    }
  }

  private itemRank(item: DigestItem): number {
    const qualityOk = item.qualityLabel === 'ok' ? 1 : 0;
    const tier = this.sourceTierRank(item.sourceName);
    const importance = Number(item.importance || 0);
    const publishedTs = this.parseDateTime(item.publishedAt)?.getTime() ?? 0;
    return (
      qualityOk * 1_000_000_000 +
      tier * 1_000_000 +
      importance * 1_000 +
      publishedTs
    );
  }

  private sourceTierRank(sourceName?: string): number {
    const normalized = normalizeSourceName(sourceName || '').toLowerCase();
    if (!normalized) {
      return 0;
    }

    const tierANormalized = new Set(
      [...SOURCE_TIER_A].map((s) => normalizeSourceName(s).toLowerCase()),
    );
    const tierBNormalized = new Set(
      [...SOURCE_TIER_B].map((s) => normalizeSourceName(s).toLowerCase()),
    );
    if (tierANormalized.has(normalized)) {
      return 2;
    }
    if (tierBNormalized.has(normalized)) {
      return 1;
    }
    return 0;
  }

  private hasDuplicateDedupeKey(items: DigestItem[]): boolean {
    const seen = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      if (item.status !== 'kept' && item.status !== 'published') {
        continue;
      }
      const key = cleanText(item.dedupeKey);
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
    }
    return false;
  }

  private hasDuplicateImpactLabels(signals: unknown): boolean {
    if (!Array.isArray(signals)) {
      return false;
    }
    const labels: string[] = [];
    for (const entry of signals) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const label = cleanText(
        (entry as { label?: string }).label || '',
      ).toLowerCase();
      if (!label) {
        continue;
      }
      labels.push(label);
    }
    return new Set(labels).size !== labels.length;
  }

  private hasDuplicateImpactEvidence(signals: unknown): boolean {
    if (!Array.isArray(signals)) {
      return false;
    }

    const seen = new Set<string>();
    for (const entry of signals) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const evidence = cleanText(
        (entry as { evidence?: string }).evidence || '',
      );
      if (!evidence) {
        continue;
      }
      const key = this.normalizeEvidenceKey(evidence);
      if (!key) {
        continue;
      }
      if (seen.has(key)) {
        return true;
      }
      seen.add(key);
    }

    return false;
  }

  private iterImpactSignalEntries(signals: unknown): Array<[string, string]> {
    if (!Array.isArray(signals)) {
      return [];
    }

    const out: Array<[string, string]> = [];
    for (const entry of signals) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const record = entry as { label?: string; evidence?: string };
      const label = cleanText(record.label || '').toLowerCase();
      const evidence = cleanText(record.evidence || '');
      if (!label) {
        continue;
      }
      out.push([label, evidence]);
    }
    return out;
  }

  private normalizeEvidenceKey(text: string): string {
    const t = cleanText(text || '').toLowerCase();
    if (!t) {
      return '';
    }
    return t
      .replace(/[^a-z0-9가-힣]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isEvidenceTooShort(text: string): boolean {
    const t = cleanText(text || '');
    if (!t) {
      return true;
    }
    if (t.length < 20) {
      return true;
    }
    if (t.split(/\s+/).filter(Boolean).length < 6) {
      return true;
    }
    return false;
  }

  private hasNumberToken(text: string): boolean {
    const t = cleanText(text || '');
    if (!t) {
      return false;
    }
    if (/\d/.test(t)) {
      return true;
    }
    return [
      '억',
      '조',
      '만',
      '%',
      '달러',
      '원',
      'billion',
      'million',
      'trillion',
      'usd',
      '$',
    ].some((unit) => t.toLowerCase().includes(unit));
  }

  private policyEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    if (!t) {
      return false;
    }
    const hasPolicyKeyword =
      (['policy', ...POLICY_STRONG_KEYWORDS] as string[]).some((k) =>
        t.includes(k.toLowerCase()),
      ) ||
      t.includes('법안') ||
      t.includes('규제') ||
      t.includes('관세');
    if (!hasPolicyKeyword) {
      return false;
    }
    if (POLICY_STRONG_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) {
      return true;
    }
    if (
      POLICY_GOV_KEYWORDS.some((k) => t.includes(k.toLowerCase())) &&
      POLICY_NEGOTIATION_KEYWORDS.some((k) => t.includes(k.toLowerCase()))
    ) {
      return false;
    }
    if (POLICY_TRADE_ONLY_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) {
      return false;
    }
    return false;
  }

  private sanctionsEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    return SANCTIONS_EVIDENCE_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
  }

  private marketDemandEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    return MARKET_DEMAND_EVIDENCE_KEYWORDS.some((k) =>
      t.includes(k.toLowerCase()),
    );
  }

  private earningsEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    return (
      EARNINGS_METRIC_KEYWORDS.some((k) => t.includes(k.toLowerCase())) &&
      this.hasNumberToken(t)
    );
  }

  private capexEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    const hasAction = CAPEX_ACTION_KEYWORDS.some((k) =>
      t.includes(k.toLowerCase()),
    );
    const hasPlan =
      CAPEX_PLAN_KEYWORDS.some((k) => t.includes(k.toLowerCase())) ||
      this.hasNumberToken(t);
    return hasAction && hasPlan;
  }

  private infraEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    return INFRA_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
  }

  private securityEvidenceValid(text: string): boolean {
    const t = cleanText(text || '').toLowerCase();
    return SECURITY_EVIDENCE_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
  }

  private lowQualityExceptionOk(item: DigestItem): boolean {
    const why = cleanText(item.whyImportant || '');
    const rationale = cleanText(item.importanceRationale || '');
    const importance = Number(item.importance || 0);

    if (
      why === '판단 근거 부족' &&
      rationale === '근거 부족으로 영향 판단 불가' &&
      importance === 1
    ) {
      return true;
    }

    if (item.qualityLabel === 'low_quality') {
      return Boolean(item.qualityReason) && importance <= 2;
    }

    return false;
  }

  private isOutdatedItem(item: DigestItem): boolean {
    const published = this.parseDateTime(item.publishedAt);
    const base = this.parseDateBase(item.date);
    if (!published || !base) {
      return false;
    }
    const diffHours = Math.abs(
      (published.getTime() - base.getTime()) / (1000 * 60 * 60),
    );
    const labels = Array.isArray(item.impactSignals)
      ? item.impactSignals
          .map((signal) => cleanText(signal?.label || '').toLowerCase())
          .filter(Boolean)
      : [];
    const hasExceptionSignal = labels.some((label) =>
      TOP_FRESH_EXCEPT_SIGNALS.has(label as ImpactSignalLabel),
    );
    const freshnessLimit = hasExceptionSignal
      ? TOP_FRESH_EXCEPT_MAX_HOURS
      : TOP_FRESH_MAX_HOURS;
    return diffHours > freshnessLimit;
  }

  private parseDateTime(value: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    return null;
  }

  private parseDateBase(value: string): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private detectStaleIncident(date: string, text: string): boolean {
    const baseDate = this.parseDateBase(date);
    if (!baseDate) {
      return false;
    }

    const lowered = cleanText(text || '').toLowerCase();
    if (!lowered) {
      return false;
    }

    if (
      !STALE_INCIDENT_TOPICAL_KEYWORDS.some((kw) =>
        lowered.includes(kw.toLowerCase()),
      )
    ) {
      return false;
    }

    const candidates: Array<{ date: Date; score: number }> = [];

    for (const pattern of EXPLICIT_DATE_PATTERNS) {
      pattern.lastIndex = 0;
      let match = pattern.exec(lowered);
      while (match) {
        const groups = match.groups as
          | { year?: string; month?: string; day?: string }
          | undefined;
        const year = Number(groups?.year);
        const month = Number(groups?.month);
        const day = Number(groups?.day);
        if (year && month && day) {
          const eventDate = new Date(
            Date.UTC(year, month - 1, day, 0, 0, 0) - 9 * 60 * 60 * 1000,
          );

          if (!Number.isNaN(eventDate.getTime())) {
            const start = Math.max(0, (match.index ?? 0) - 50);
            const end = Math.min(
              lowered.length,
              (match.index ?? 0) + match[0].length + 60,
            );
            const context = lowered.slice(start, end);
            let score = 0;
            if (
              INCIDENT_CONTEXT_KEYWORDS.some((kw) =>
                context.includes(kw.toLowerCase()),
              )
            ) {
              score += 2;
            }
            if (
              NON_EVENT_DATE_CONTEXT_KEYWORDS.some((kw) =>
                context.includes(kw.toLowerCase()),
              )
            ) {
              score -= 2;
            }
            if (score > 0) {
              candidates.push({ date: eventDate, score });
            }
          }
        }
        match = pattern.exec(lowered);
      }
    }

    if (candidates.length === 0) {
      return false;
    }

    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.date.getTime() - b.date.getTime();
    });

    const eventDate = candidates[0].date;
    const ageDays =
      (baseDate.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays > STALE_EVENT_MAX_DAYS;
  }

  private summaryText(summary: string[] | string): string {
    if (Array.isArray(summary)) {
      return summary
        .map((line) => cleanText(line))
        .filter(Boolean)
        .join(' ');
    }
    return cleanText(summary || '');
  }
}
