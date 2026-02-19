import { Injectable, Logger } from '@nestjs/common';
import {
  BREAKING_MIN_SLOTS,
  EDITOR_NOTE,
  MIN_TOP_ITEMS,
  QUESTION_OF_THE_DAY,
  SELECTION_CRITERIA,
  SOURCE_MAX_PER_OUTLET,
  SOURCE_DROP_NOT_SELECTED_TOP_N,
  TOP_CATEGORY_BALANCE_ENABLED,
  TOP_CATEGORY_MAX_SHARE,
  TOP_LIMIT,
} from '../config/digest.constants';
import { RSS_SOURCES } from '../config/rss-sources';
import {
  CandidateItem,
  DailyDigest,
  DigestItem,
  DigestMetrics,
  ImpactSignal,
  ImpactSignalLabel,
} from '../types/digest.types';
import {
  computeAgeHours,
  formatDateYYYYMMDD,
  formatKstIso,
  getKstNow,
} from '../utils/date.util';
import {
  cleanText,
  estimateReadTimeSeconds,
  normalizeSourceName,
  splitSummaryToLines,
} from '../utils/text.util';
import { DigestDedupeService } from './digest-dedupe.service';
import { RssFeedService } from './rss-feed.service';
import { DigestScoringService } from './digest-scoring.service';
import { DigestStorageService } from './digest-storage.service';
import { DigestAiService } from './digest-ai.service';
import { DigestValidationService } from './digest-validation.service';

const INTERNATIONAL_CATEGORY_HINTS = [
  '글로벌',
  '국제',
  '정세',
  '지정학',
  '외교',
  '미국',
  '중국',
  '일본',
  '유럽',
  'eu',
  'nato',
  'g7',
  'g20',
  '중동',
  '러시아',
  '우크라',
  '이스라엘',
  '이란',
  '트럼프',
  '백악관',
  '워싱턴',
];

const DOMESTIC_POLICY_HINTS = [
  '국내',
  '국회',
  '대통령실',
  '금융위원회',
  '금감원',
  '공정위',
  '방통위',
  '과기정통부',
  '산업부',
  '기재부',
  '행안부',
  '복지부',
  '국토부',
  '서울시',
  '한국은행',
];

@Injectable()
export class DigestGeneratorService {
  private readonly logger = new Logger(DigestGeneratorService.name);
  private readonly inFlightGenerations = new Map<
    string,
    Promise<DailyDigest>
  >();

  constructor(
    private readonly rssFeedService: RssFeedService,
    private readonly dedupeService: DigestDedupeService,
    private readonly scoringService: DigestScoringService,
    private readonly storageService: DigestStorageService,
    private readonly digestAiService: DigestAiService,
    private readonly digestValidationService: DigestValidationService,
  ) {}

  async generateDigest(options?: {
    topLimit?: number;
    forceRegenerate?: boolean;
  }): Promise<DailyDigest> {
    const nowKst = getKstNow();
    const dateStr = formatDateYYYYMMDD(nowKst);
    const topLimit = this.resolveTopLimit(options?.topLimit);
    const forceRegenerate = Boolean(options?.forceRegenerate);
    const lockKey = `${dateStr}:${topLimit}:${forceRegenerate ? '1' : '0'}`;

    const inFlight = this.inFlightGenerations.get(lockKey);
    if (inFlight) {
      return inFlight;
    }

    const task = this.generateDigestCore({
      nowKst,
      dateStr,
      topLimit,
      forceRegenerate,
    });
    this.inFlightGenerations.set(lockKey, task);
    try {
      return await task;
    } finally {
      if (this.inFlightGenerations.get(lockKey) === task) {
        this.inFlightGenerations.delete(lockKey);
      }
    }
  }

  private async generateDigestCore(params: {
    nowKst: Date;
    dateStr: string;
    topLimit: number;
    forceRegenerate: boolean;
  }): Promise<DailyDigest> {
    const { nowKst, dateStr, topLimit, forceRegenerate } = params;
    const startedAt = Date.now();
    this.logger.log(
      `generate start: date=${dateStr} topLimit=${topLimit} force=${forceRegenerate ? 1 : 0} sources=${RSS_SOURCES.length}`,
    );

    if (!forceRegenerate) {
      const existing = await this.storageService.loadDigest();
      if (existing?.date === dateStr && existing.items.length > 0) {
        return this.clampDigestItems(existing, topLimit);
      }
    }

    const historyMap = await this.storageService.loadRecentClusterMap(dateStr);

    const seenTitles: string[] = [];
    const seenDedupeKeys: string[] = [];
    const candidates: CandidateItem[] = [];

    const skipReasons: Record<string, number> = {};
    const sourceDropReasons: Record<string, Record<string, number>> = {};
    const topicInCounts: Record<string, number> = {};
    let totalIn = 0;

    const sourceFeeds = await Promise.all(
      RSS_SOURCES.map(async (source) => ({
        source,
        entries: await this.rssFeedService.fetch(source.url, source.limit, {
          freshnessWindow: source.freshnessWindow,
        }),
      })),
    );
    const fetchedEntries = sourceFeeds.reduce(
      (sum, feed) => sum + feed.entries.length,
      0,
    );
    this.logger.log(
      `stage rss_fetch done: entries=${fetchedEntries} nonEmptySources=${sourceFeeds.filter((feed) => feed.entries.length > 0).length}/${sourceFeeds.length} elapsedMs=${Date.now() - startedAt}`,
    );

    for (const { source, entries } of sourceFeeds) {
      for (const entry of entries) {
        totalIn += 1;
        this.incrementCounter(topicInCounts, source.topic || 'unknown');
        const title = cleanText(entry.title);
        const summary = cleanText(entry.summary);
        const sourceRaw = cleanText(entry.sourceName || '');
        const sourceNormalized = normalizeSourceName(sourceRaw) || sourceRaw;
        const sourceName = sourceRaw || sourceNormalized;
        const link = entry.link;
        const ageHours = computeAgeHours(entry.publishedAt);

        const analysisText = `${title} ${summary}`.trim();
        const impactSignals =
          this.scoringService.getImpactSignals(analysisText);

        const skipReason = this.scoringService.getSkipReason({
          title,
          summary,
          link,
          ageHours,
          impactSignals,
        });
        if (skipReason) {
          this.incrementCounter(skipReasons, skipReason);
          this.incrementNestedCounter(
            sourceDropReasons,
            sourceName || source.topic || 'unknown',
            skipReason,
          );
          continue;
        }

        const dedupeKey = this.dedupeService.buildDedupeKey(title, summary);
        const clusterKey = this.dedupeService.buildClusterKey(
          dedupeKey,
          title,
          summary,
        );

        if (clusterKey && historyMap.has(clusterKey)) {
          this.incrementCounter(skipReasons, 'carry_over_duplicate');
          this.incrementNestedCounter(
            sourceDropReasons,
            sourceName || source.topic || 'unknown',
            'carry_over_duplicate',
          );
          continue;
        }

        if (this.dedupeService.isTitleDuplicate(title, seenTitles)) {
          this.incrementCounter(skipReasons, 'duplicate_title');
          this.incrementNestedCounter(
            sourceDropReasons,
            sourceName || source.topic || 'unknown',
            'duplicate_title',
          );
          continue;
        }

        if (
          this.dedupeService.isNearDuplicateByKey(dedupeKey, seenDedupeKeys)
        ) {
          this.incrementCounter(skipReasons, 'duplicate_dedupe_key');
          this.incrementNestedCounter(
            sourceDropReasons,
            sourceName || source.topic || 'unknown',
            'duplicate_dedupe_key',
          );
          continue;
        }

        const readTimeSec = estimateReadTimeSeconds(summary || title);
        const isBreaking = this.scoringService.isBreakingNews({
          title,
          summary,
        });
        const score = this.scoringService.scoreItem({
          impactSignals,
          readTimeSec,
          sourceName: sourceNormalized,
          ageHours,
          isBreaking,
        });

        candidates.push({
          title,
          link,
          summary,
          topic: source.topic,
          sourceName,
          sourceRaw,
          sourceNormalized,
          publishedAt: entry.publishedAt,
          ageHours,
          impactSignals,
          score,
          dedupeKey,
          clusterKey,
          readTimeSec,
          matchedTo: null,
          isBreaking,
        });

        seenTitles.push(title);
        seenDedupeKeys.push(dedupeKey);
      }
    }
    this.logger.log(
      `stage candidate_filter done: totalIn=${totalIn} candidates=${candidates.length} dropped=${Math.max(
        0,
        totalIn - candidates.length,
      )} reasons=${this.formatTopReasons(skipReasons)}`,
    );

    const aiImportanceStartedAt = Date.now();
    this.logger.log(
      `stage ai_importance start: candidates=${candidates.length}`,
    );
    await this.digestAiService.applyAiImportance(candidates);
    this.logger.log(
      `stage ai_importance done: elapsedMs=${Date.now() - aiImportanceStartedAt}`,
    );
    const semanticDedupeStartedAt = Date.now();
    this.logger.log(
      `stage semantic_dedupe start: candidates=${candidates.length}`,
    );
    const dedupedCandidates =
      await this.digestAiService.applySemanticDedupe(candidates);
    this.logger.log(
      `stage semantic_dedupe done: in=${candidates.length} out=${dedupedCandidates.length} elapsedMs=${Date.now() - semanticDedupeStartedAt}`,
    );
    for (const candidate of candidates) {
      if (candidate.status !== 'merged' && candidate.status !== 'dropped') {
        continue;
      }
      const reason =
        candidate.mergeReason || candidate.dropReason || candidate.status;
      this.incrementCounter(skipReasons, reason);
      this.incrementNestedCounter(
        sourceDropReasons,
        candidate.sourceName || candidate.topic || 'unknown',
        reason,
      );
    }
    const selected = this.selectTopWithBreakingSlots(
      dedupedCandidates,
      topLimit,
    );
    this.logger.log(
      `stage select done: selected=${selected.length}/${topLimit} from=${dedupedCandidates.length}`,
    );
    const selectedSet = new Set(selected);
    for (const candidate of dedupedCandidates) {
      if (selectedSet.has(candidate)) {
        continue;
      }
      this.incrementCounter(skipReasons, 'not_selected');
      this.incrementNestedCounter(
        sourceDropReasons,
        candidate.sourceName || candidate.topic || 'unknown',
        'not_selected',
      );
    }
    const enrichStartedAt = Date.now();
    this.logger.log(
      `stage ai_enrich_selected start: selected=${selected.length}`,
    );
    await this.digestAiService.enrichSelectedItems(selected);
    this.logger.log(
      `stage ai_enrich_selected done: elapsedMs=${Date.now() - enrichStartedAt}`,
    );
    const draftDigest = this.buildDigestFromCandidates(
      dateStr,
      nowKst,
      selected,
    );
    const digest = this.digestValidationService.normalizeDigest(draftDigest);
    const validationStats =
      this.digestValidationService.getLastNormalizationStats();
    const validationDroppedBySource = this.countValidationDroppedBySource(
      selected,
      digest.items,
    );
    for (const [source, droppedCount] of Object.entries(
      validationDroppedBySource,
    )) {
      if (droppedCount <= 0) {
        continue;
      }
      this.incrementNestedCounter(
        sourceDropReasons,
        source,
        'validation_dropped',
        droppedCount,
      );
    }
    const validationDroppedTotal = Object.values(
      validationDroppedBySource,
    ).reduce((sum, count) => sum + Number(count || 0), 0);
    if (validationDroppedTotal > 0) {
      this.incrementCounter(
        skipReasons,
        'validation_dropped',
        validationDroppedTotal,
      );
    }
    const topicStats = this.buildTopicStats(
      topicInCounts,
      selected,
      digest.items,
    );
    const breakingSelection = this.buildBreakingSelectionStats(
      dedupedCandidates,
      digest.items,
    );
    this.logger.log(
      `validation normalization: before=${validationStats.beforeCount} after=${validationStats.afterCount} dropped=${validationStats.dropped} reasons=${JSON.stringify(validationStats.dropReasons)}`,
    );
    const validation = this.digestValidationService.validateDigest(digest);

    if (!validation.valid) {
      if (
        validation.error === 'INVALID_DIGEST' &&
        digest.items.length > 0 &&
        digest.items.length < MIN_TOP_ITEMS
      ) {
        this.logger.warn(
          `minimum item count(${MIN_TOP_ITEMS}) not met, saving partial digest (${digest.items.length})`,
        );
      } else if (
        this.digestValidationService.isHardValidationError(validation.error)
      ) {
        throw new Error(validation.error);
      } else {
        const existing = await this.storageService.loadDigest();
        if (existing) {
          const existingValidation =
            this.digestValidationService.validateDigest(existing);
          if (existingValidation.valid) {
            this.logger.warn(
              `digest invalid(${validation.error}), keeping previous digest (${existing.date})`,
            );
            return existing;
          }
        }
        throw new Error(
          `digest generation failed: invalid ${MIN_TOP_ITEMS}~${TOP_LIMIT} items and no valid existing file`,
        );
      }
    }

    const metrics = this.buildMetrics(
      digest,
      totalIn,
      skipReasons,
      validationStats.dropReasons,
      topicStats,
      sourceDropReasons,
      breakingSelection,
    );
    await this.storageService.saveDigest(digest);
    await this.storageService.saveMetrics(metrics);
    await this.storageService.updateHistory(digest);
    this.logger.log(
      `generate done: date=${digest.date} items=${digest.items.length} totalIn=${totalIn} elapsedMs=${Date.now() - startedAt}`,
    );

    return digest;
  }

  private buildDigestFromCandidates(
    dateStr: string,
    nowKst: Date,
    selected: CandidateItem[],
  ): DailyDigest {
    const items: DigestItem[] = selected.map((candidate, index) => {
      const ai = candidate.ai;
      const title = ai?.titleKo || candidate.title;
      const summaryLines = ai?.summaryLines?.length
        ? ai.summaryLines
        : splitSummaryToLines(candidate.summary);
      const impactSignals = ai?.impactSignals?.length
        ? ai.impactSignals
        : this.buildImpactSignals(candidate, summaryLines);
      const importanceRaw = Number.isFinite(ai?.importanceRawScore as number)
        ? Number(ai?.importanceRawScore)
        : Number.isFinite(candidate.aiImportanceRaw as number)
          ? Number(candidate.aiImportanceRaw)
          : Number.isFinite(candidate.aiImportance as number)
            ? this.scoringService.displayToRawImportance(
                Number(candidate.aiImportance),
              )
            : this.scoringService.inferImportanceRaw(candidate);
      const importance = Number.isFinite(ai?.importanceScore as number)
        ? this.scoringService.normalizeDisplayImportance(
            Number(ai?.importanceScore),
          )
        : Number.isFinite(candidate.aiImportance as number)
          ? this.scoringService.normalizeDisplayImportance(
              Number(candidate.aiImportance),
            )
          : this.scoringService.rawToDisplayImportance(importanceRaw);
      const category = this.inferCandidateCategory(candidate);
      const qualityLabel =
        ai?.qualityLabel ||
        candidate.aiQuality ||
        (summaryLines.length >= 1 ? 'ok' : 'low_quality');
      const qualityReason =
        ai?.qualityReason ||
        (qualityLabel === 'ok' ? '정보성 기사' : '요약 근거 부족');
      const whyImportant =
        ai?.whyImportant || this.buildWhyImportant(candidate, category);
      const importanceRationale =
        ai?.importanceRationale ||
        this.buildImportanceRationale(candidate, importance);
      const dedupeKey = ai?.dedupeKey || candidate.dedupeKey;

      return {
        id: `${dateStr}_${index + 1}`,
        date: dateStr,
        category,
        title,
        summary: summaryLines.length
          ? summaryLines
          : [candidate.summary || candidate.title],
        whyImportant,
        importanceRationale,
        impactSignals,
        dedupeKey,
        clusterKey: candidate.clusterKey,
        matchedTo: candidate.matchedTo,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.link,
        publishedAt: candidate.publishedAt,
        readTimeSec: candidate.readTimeSec,
        status: 'kept',
        importance,
        importanceRaw,
        qualityLabel,
        qualityReason,
        isBriefing: false,
        isBreaking: Boolean(candidate.isBreaking),
      };
    });

    return {
      date: dateStr,
      selectionCriteria: SELECTION_CRITERIA,
      editorNote: EDITOR_NOTE,
      question: QUESTION_OF_THE_DAY,
      lastUpdatedAt: formatKstIso(nowKst),
      items,
    };
  }

  private buildImpactSignals(
    candidate: CandidateItem,
    summaryLines: string[],
  ): ImpactSignal[] {
    const evidenceSource =
      summaryLines[0] || candidate.summary || candidate.title;
    return candidate.impactSignals.map((label) => ({
      label,
      evidence: cleanText(evidenceSource).slice(0, 280),
    }));
  }

  private buildWhyImportant(
    candidate: CandidateItem,
    category: string,
  ): string {
    if (candidate.impactSignals.length === 0) {
      return `${category} 카테고리에서 구조적 영향 가능성이 있어 추적이 필요한 이슈입니다.`;
    }

    const first = candidate.impactSignals[0];
    const reasonMap: Record<ImpactSignalLabel, string> = {
      policy: '정책/규제 변화는 산업 의사결정에 직접적인 영향을 줍니다.',
      sanctions: '제재 이슈는 공급망과 거래 리스크를 크게 바꿀 수 있습니다.',
      capex: '대규모 설비투자는 중장기 수급과 경쟁구도를 바꿀 가능성이 큽니다.',
      infra: '인프라 이슈는 서비스 안정성과 비용에 즉시 영향을 줍니다.',
      security: '보안 이슈는 운영 리스크와 규제 대응 부담을 키울 수 있습니다.',
      earnings:
        '실적/가이던스 변화는 업황과 투자심리의 선행 신호가 될 수 있습니다.',
      'market-demand':
        '수요/가격 변화는 시장 방향성을 판단하는 핵심 지표입니다.',
    };

    return reasonMap[first];
  }

  private buildImportanceRationale(
    candidate: CandidateItem,
    importance: number,
  ): string {
    const labels = candidate.impactSignals.join(', ');
    const ageLabel =
      candidate.ageHours == null
        ? '발행시점 정보 없음'
        : `발행 후 약 ${Math.round(candidate.ageHours)}시간`;

    if (!labels) {
      return `근거: ${ageLabel}, 출처 신뢰도와 주제 적합도를 반영해 중요도 ${importance}로 산정.`;
    }

    return `근거: 영향 신호(${labels}), ${ageLabel}, 출처 신뢰도를 종합해 중요도 ${importance}로 산정.`;
  }

  private buildMetrics(
    digest: DailyDigest,
    totalIn: number,
    skipReasons: Record<string, number>,
    validationDropReasons?: Record<string, number>,
    topicStats?: Record<string, { in: number; out: number; dropped: number }>,
    sourceDropReasons?: Record<string, Record<string, number>>,
    breakingSelection?: {
      candidates: number;
      selected: number;
      selectionRate: number;
      selectedShare: number;
    },
  ): DigestMetrics {
    const impactLabels: Record<string, number> = {};
    const sources: Record<string, number> = {};
    const categories: Record<string, number> = {};
    const importanceDistribution: Record<string, number> = {};

    for (const item of digest.items) {
      sources[item.sourceName] = (sources[item.sourceName] ?? 0) + 1;
      categories[item.category] = (categories[item.category] ?? 0) + 1;
      const importanceKey = String(item.importance);
      importanceDistribution[importanceKey] =
        (importanceDistribution[importanceKey] ?? 0) + 1;

      for (const signal of item.impactSignals) {
        impactLabels[signal.label] = (impactLabels[signal.label] ?? 0) + 1;
      }
    }

    const sourceValues = Object.values(sources);

    return {
      type: 'metrics_summary',
      date: digest.date,
      totalIn,
      totalOut: digest.items.length,
      dropped: totalIn - digest.items.length,
      dropReasons: this.mergeDropReasons(skipReasons, validationDropReasons),
      impactLabels,
      sources,
      topicStats,
      sourceDropReasons: this.compressSourceDropReasons(sourceDropReasons),
      breakingSelection,
      categories,
      importanceDistribution,
      topDiversity: {
        uniqueSources: Object.keys(sources).length,
        uniqueCategories: Object.keys(categories).length,
        maxPerSource: sourceValues.length ? Math.max(...sourceValues) : 0,
      },
    };
  }

  private mergeDropReasons(
    preFilter: Record<string, number>,
    validation?: Record<string, number>,
  ): Record<string, number> {
    const merged: Record<string, number> = {};
    for (const [key, value] of Object.entries(preFilter || {})) {
      merged[key] = (merged[key] ?? 0) + Number(value || 0);
    }
    for (const [key, value] of Object.entries(validation || {})) {
      merged[key] = (merged[key] ?? 0) + Number(value || 0);
    }
    return merged;
  }

  private formatTopReasons(reasons: Record<string, number>, topN = 8): string {
    const pairs = Object.entries(reasons || {})
      .map(([key, value]) => [key, Number(value || 0)] as const)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN);
    return JSON.stringify(Object.fromEntries(pairs));
  }

  private compressSourceDropReasons(
    sourceDropReasons?: Record<string, Record<string, number>>,
    notSelectedTopN = SOURCE_DROP_NOT_SELECTED_TOP_N,
  ): Record<string, Record<string, number>> | undefined {
    if (!sourceDropReasons) {
      return undefined;
    }

    const normalizedTopN = Math.max(0, Math.floor(notSelectedTopN || 0));
    const notSelectedRanking = Object.entries(sourceDropReasons)
      .map(([source, reasons]) => ({
        source,
        count: Number(reasons?.not_selected ?? 0),
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
    const keepSet = new Set(
      notSelectedRanking.slice(0, normalizedTopN).map((entry) => entry.source),
    );

    const compressed: Record<string, Record<string, number>> = {};
    let otherNotSelected = 0;

    for (const [source, reasons] of Object.entries(sourceDropReasons)) {
      const nextReasons: Record<string, number> = {};
      for (const [reason, countRaw] of Object.entries(reasons || {})) {
        const count = Number(countRaw || 0);
        if (count <= 0) {
          continue;
        }
        if (reason === 'not_selected' && !keepSet.has(source)) {
          otherNotSelected += count;
          continue;
        }
        nextReasons[reason] = count;
      }
      if (Object.keys(nextReasons).length > 0) {
        compressed[source] = nextReasons;
      }
    }

    if (otherNotSelected > 0) {
      compressed.__others__ = {
        ...(compressed.__others__ ?? {}),
        not_selected:
          Number(compressed.__others__?.not_selected ?? 0) + otherNotSelected,
      };
    }

    return compressed;
  }

  private buildTopicStats(
    topicInCounts: Record<string, number>,
    selected: CandidateItem[],
    finalItems: DigestItem[],
  ): Record<string, { in: number; out: number; dropped: number }> {
    const topicOutCounts: Record<string, number> = {};
    const topicBySourceUrl = new Map<string, string[]>();

    for (const candidate of selected) {
      const key = this.sourceUrlKey(candidate.sourceName, candidate.link);
      const topic = candidate.topic || 'unknown';
      const bucket = topicBySourceUrl.get(key);
      if (bucket) {
        bucket.push(topic);
      } else {
        topicBySourceUrl.set(key, [topic]);
      }
    }

    for (const item of finalItems) {
      const key = this.sourceUrlKey(item.sourceName, item.sourceUrl);
      const bucket = topicBySourceUrl.get(key);
      const topic = bucket?.shift() || 'unknown';
      this.incrementCounter(topicOutCounts, topic);
    }

    const stats: Record<string, { in: number; out: number; dropped: number }> =
      {};
    const topics = new Set([
      ...Object.keys(topicInCounts),
      ...Object.keys(topicOutCounts),
    ]);
    for (const topic of topics) {
      const inCount = topicInCounts[topic] ?? 0;
      const outCount = topicOutCounts[topic] ?? 0;
      stats[topic] = {
        in: inCount,
        out: outCount,
        dropped: Math.max(0, inCount - outCount),
      };
    }

    return stats;
  }

  private buildBreakingSelectionStats(
    candidatePool: CandidateItem[],
    finalItems: DigestItem[],
  ): {
    candidates: number;
    selected: number;
    selectionRate: number;
    selectedShare: number;
  } {
    const breakingCandidates = candidatePool.filter(
      (item) => item.isBreaking,
    ).length;
    const selectedBreaking = finalItems.filter(
      (item) => item.isBreaking,
    ).length;
    const totalSelected = finalItems.length;

    return {
      candidates: breakingCandidates,
      selected: selectedBreaking,
      selectionRate:
        breakingCandidates > 0
          ? Number((selectedBreaking / breakingCandidates).toFixed(4))
          : 0,
      selectedShare:
        totalSelected > 0
          ? Number((selectedBreaking / totalSelected).toFixed(4))
          : 0,
    };
  }

  private countValidationDroppedBySource(
    selected: CandidateItem[],
    finalItems: DigestItem[],
  ): Record<string, number> {
    const keptBySourceUrl: Record<string, number> = {};
    for (const item of finalItems) {
      const key = this.sourceUrlKey(item.sourceName, item.sourceUrl);
      keptBySourceUrl[key] = (keptBySourceUrl[key] ?? 0) + 1;
    }

    const droppedBySource: Record<string, number> = {};
    for (const candidate of selected) {
      const key = this.sourceUrlKey(candidate.sourceName, candidate.link);
      const kept = keptBySourceUrl[key] ?? 0;
      if (kept > 0) {
        keptBySourceUrl[key] = kept - 1;
        continue;
      }
      const source = candidate.sourceName || candidate.topic || 'unknown';
      droppedBySource[source] = (droppedBySource[source] ?? 0) + 1;
    }
    return droppedBySource;
  }

  private sourceUrlKey(sourceName: string, url: string): string {
    return `${cleanText(sourceName || '').toLowerCase()}|${cleanText(url || '')}`;
  }

  private incrementCounter(
    target: Record<string, number>,
    key: string,
    amount = 1,
  ): void {
    const safeKey = cleanText(key || 'unknown') || 'unknown';
    target[safeKey] = (target[safeKey] ?? 0) + Math.max(0, amount);
  }

  private incrementNestedCounter(
    target: Record<string, Record<string, number>>,
    outerKey: string,
    innerKey: string,
    amount = 1,
  ): void {
    const outer = cleanText(outerKey || 'unknown') || 'unknown';
    const inner = cleanText(innerKey || 'unknown') || 'unknown';
    if (!target[outer]) {
      target[outer] = {};
    }
    target[outer][inner] = (target[outer][inner] ?? 0) + Math.max(0, amount);
  }

  private resolveTopLimit(raw: number | undefined): number {
    if (!Number.isFinite(raw as number)) {
      return TOP_LIMIT;
    }
    const normalized = Math.floor(Number(raw));
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return TOP_LIMIT;
    }
    return Math.min(TOP_LIMIT, normalized);
  }

  private clampDigestItems(digest: DailyDigest, topLimit: number): DailyDigest {
    if (!Array.isArray(digest.items) || digest.items.length <= topLimit) {
      return digest;
    }
    return {
      ...digest,
      items: digest.items.slice(0, topLimit),
    };
  }

  private selectTopWithBreakingSlots(
    allItems: CandidateItem[],
    limit: number,
  ): CandidateItem[] {
    if (limit <= 0 || allItems.length === 0) {
      return [];
    }

    const baseSelected = this.dedupeService.pickTopWithDiversity(
      allItems,
      limit,
    );
    const requiredBreaking = Math.min(BREAKING_MIN_SLOTS, limit);
    if (requiredBreaking <= 0) {
      return this.rebalanceSelectedByCategory(allItems, baseSelected, limit);
    }

    const breakingPool = allItems.filter((item) => item.isBreaking);
    if (breakingPool.length === 0) {
      return this.rebalanceSelectedByCategory(allItems, baseSelected, limit);
    }

    const currentBreaking = baseSelected.filter(
      (item) => item.isBreaking,
    ).length;
    if (currentBreaking >= requiredBreaking) {
      return this.rebalanceSelectedByCategory(allItems, baseSelected, limit);
    }

    const forcedBreaking = this.dedupeService.pickTopWithDiversity(
      breakingPool,
      Math.min(requiredBreaking, breakingPool.length),
    );
    const forcedSet = new Set(forcedBreaking);

    const remainderPool = allItems.filter((item) => !forcedSet.has(item));
    const remainder = this.dedupeService.pickTopWithDiversity(
      remainderPool,
      Math.max(0, limit - forcedBreaking.length),
    );

    const withBreaking = [...forcedBreaking, ...remainder]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return this.rebalanceSelectedByCategory(allItems, withBreaking, limit);
  }

  private rebalanceSelectedByCategory(
    allItems: CandidateItem[],
    selected: CandidateItem[],
    limit: number,
  ): CandidateItem[] {
    if (!TOP_CATEGORY_BALANCE_ENABLED || selected.length === 0 || limit < 8) {
      return selected;
    }

    const coreBuckets = ['정책', '경제', '국제', '기술'];
    const selectedSet = new Set(selected);
    const selectedBucketCounts = new Map<string, number>();
    const selectedSourceCounts = new Map<string, number>();

    for (const item of selected) {
      const bucket = this.inferBalanceBucket(item);
      selectedBucketCounts.set(
        bucket,
        (selectedBucketCounts.get(bucket) ?? 0) + 1,
      );
      const source = cleanText(item.sourceName || '').toLowerCase();
      selectedSourceCounts.set(
        source,
        (selectedSourceCounts.get(source) ?? 0) + 1,
      );
    }

    const availableByBucket = new Map<string, CandidateItem[]>();
    for (const item of allItems) {
      const bucket = this.inferBalanceBucket(item);
      if (!coreBuckets.includes(bucket)) {
        continue;
      }
      const group = availableByBucket.get(bucket);
      if (group) {
        group.push(item);
      } else {
        availableByBucket.set(bucket, [item]);
      }
    }
    for (const bucket of availableByBucket.values()) {
      bucket.sort((a, b) => b.score - a.score);
    }

    const activeCoreBuckets = coreBuckets.filter((bucket) => {
      const available = availableByBucket.get(bucket)?.length ?? 0;
      return available > 0;
    });
    if (activeCoreBuckets.length <= 1) {
      return selected;
    }

    const targetByBucket = this.buildBalanceTargets({
      limit,
      activeBuckets: activeCoreBuckets,
      availableByBucket,
    });
    const maxTarget = Math.max(
      ...activeCoreBuckets.map((bucket) => targetByBucket.get(bucket) ?? 0),
    );
    const maxPerBucket = Math.max(
      maxTarget + 1,
      Math.floor(limit * TOP_CATEGORY_MAX_SHARE),
    );

    for (const bucket of activeCoreBuckets) {
      const available = availableByBucket.get(bucket)?.length ?? 0;
      const targetMin = Math.min(targetByBucket.get(bucket) ?? 0, available);
      let current = selectedBucketCounts.get(bucket) ?? 0;
      let attempts = 0;
      const maxAttempts = Math.max(16, allItems.length * 2);
      while (current < targetMin) {
        if (attempts >= maxAttempts) {
          break;
        }
        attempts += 1;
        const replacement = this.findBestReplacementCandidate({
          candidates: availableByBucket.get(bucket) ?? [],
          selectedSet,
          selectedSourceCounts,
        });
        if (!replacement) {
          break;
        }

        const removed = this.findRemovableCandidate(
          selected,
          selectedBucketCounts,
          targetByBucket,
          bucket,
        );
        if (!removed) {
          break;
        }

        this.swapSelectedItem({
          selected,
          removed,
          added: replacement,
          selectedSet,
          selectedBucketCounts,
          selectedSourceCounts,
        });
        current = selectedBucketCounts.get(bucket) ?? 0;
      }
    }

    let overLoopAttempts = 0;
    const maxOverLoopAttempts = Math.max(16, allItems.length * 2);
    while (true) {
      if (overLoopAttempts >= maxOverLoopAttempts) {
        break;
      }
      overLoopAttempts += 1;
      const over = [...selectedBucketCounts.entries()]
        .filter(([, count]) => count > maxPerBucket)
        .sort((a, b) => b[1] - a[1])[0];
      if (!over) {
        break;
      }
      const [overBucket] = over;
      const removed = this.findLowestFromBucket(selected, overBucket);
      if (!removed) {
        break;
      }

      const replacement = this.findBestReplacementCandidate({
        candidates: allItems,
        selectedSet,
        selectedSourceCounts,
        predicate: (candidate) => {
          const bucket = this.inferBalanceBucket(candidate);
          if (!activeCoreBuckets.includes(bucket)) {
            return false;
          }
          return (selectedBucketCounts.get(bucket) ?? 0) < maxPerBucket;
        },
      });
      if (!replacement) {
        break;
      }

      this.swapSelectedItem({
        selected,
        removed,
        added: replacement,
        selectedSet,
        selectedBucketCounts,
        selectedSourceCounts,
      });
    }

    return [...selected].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private inferCandidateCategory(candidate: CandidateItem): string {
    const inferred =
      cleanText(candidate.ai?.categoryLabel || '') ||
      cleanText(candidate.aiCategory || '') ||
      this.scoringService.mapTopicToCategory(candidate.topic);
    if (!inferred) {
      return '국제';
    }
    const context = cleanText(
      `${candidate.topic} ${candidate.title} ${candidate.summary}`,
    ).toLowerCase();
    const hasInternationalHint = INTERNATIONAL_CATEGORY_HINTS.some((hint) =>
      context.includes(hint),
    );
    const hasDomesticPolicyHint = DOMESTIC_POLICY_HINTS.some((hint) =>
      context.includes(hint),
    );

    if (
      hasInternationalHint &&
      !hasDomesticPolicyHint &&
      (inferred === '정책' || inferred === '경제' || inferred === '금융')
    ) {
      return '국제';
    }
    if (inferred === '금융') {
      return '경제';
    }

    return inferred;
  }

  private inferBalanceBucket(candidate: CandidateItem): string {
    const category = this.inferCandidateCategory(candidate);
    if (category === '에너지') {
      return '기술';
    }
    if (category === '금융') {
      return '경제';
    }
    return category;
  }

  private buildBalanceTargets(params: {
    limit: number;
    activeBuckets: string[];
    availableByBucket: Map<string, CandidateItem[]>;
  }): Map<string, number> {
    const targets = new Map<string, number>();
    if (params.activeBuckets.length === 0 || params.limit <= 0) {
      return targets;
    }

    const fillOrder = ['국제', '경제', '정책', '기술'].filter((bucket) =>
      params.activeBuckets.includes(bucket),
    );
    const hasAllCoreBuckets =
      params.activeBuckets.includes('정책') &&
      params.activeBuckets.includes('경제') &&
      params.activeBuckets.includes('국제') &&
      params.activeBuckets.includes('기술');

    if (hasAllCoreBuckets) {
      const othersBase = Math.max(1, Math.floor((params.limit - 1) / 4));
      targets.set('정책', othersBase);
      targets.set('경제', othersBase);
      targets.set('국제', othersBase);
      targets.set('기술', othersBase + 1);
    } else {
      const base = Math.max(
        1,
        Math.floor(params.limit / params.activeBuckets.length),
      );
      for (const bucket of params.activeBuckets) {
        targets.set(bucket, base);
      }
    }

    let assigned = [...targets.values()].reduce((sum, value) => sum + value, 0);
    let remaining = Math.max(0, params.limit - assigned);
    let spreadAttempts = 0;
    while (remaining > 0 && spreadAttempts < 64) {
      spreadAttempts += 1;
      const receiver = [...fillOrder]
        .filter((bucket) => {
          const available = params.availableByBucket.get(bucket)?.length ?? 0;
          return (targets.get(bucket) ?? 0) < available;
        })
        .sort((a, b) => {
          const aTarget = targets.get(a) ?? 0;
          const bTarget = targets.get(b) ?? 0;
          return aTarget - bTarget;
        })[0];
      if (!receiver) {
        break;
      }
      targets.set(receiver, (targets.get(receiver) ?? 0) + 1);
      remaining -= 1;
    }

    let overflow = 0;
    for (const bucket of params.activeBuckets) {
      const target = targets.get(bucket) ?? 0;
      const available = params.availableByBucket.get(bucket)?.length ?? 0;
      if (target > available) {
        overflow += target - available;
        targets.set(bucket, available);
      }
    }

    let rebalanceAttempts = 0;
    while (overflow > 0 && rebalanceAttempts < 64) {
      rebalanceAttempts += 1;
      const receiver = [...fillOrder]
        .filter((bucket) => {
          const available = params.availableByBucket.get(bucket)?.length ?? 0;
          return (targets.get(bucket) ?? 0) < available;
        })
        .sort((a, b) => {
          const aTarget = targets.get(a) ?? 0;
          const bTarget = targets.get(b) ?? 0;
          return aTarget - bTarget;
        })[0];
      if (!receiver) {
        break;
      }
      targets.set(receiver, (targets.get(receiver) ?? 0) + 1);
      overflow -= 1;
    }

    assigned = [...targets.values()].reduce((sum, value) => sum + value, 0);
    if (assigned > params.limit) {
      let toReduce = assigned - params.limit;
      while (toReduce > 0) {
        const donor = [...fillOrder]
          .filter((bucket) => (targets.get(bucket) ?? 0) > 0)
          .sort((a, b) => (targets.get(b) ?? 0) - (targets.get(a) ?? 0))[0];
        if (!donor) {
          break;
        }
        targets.set(donor, Math.max(0, (targets.get(donor) ?? 0) - 1));
        toReduce -= 1;
      }
    }

    return targets;
  }

  private findBestReplacementCandidate(params: {
    candidates: CandidateItem[];
    selectedSet: Set<CandidateItem>;
    selectedSourceCounts: Map<string, number>;
    predicate?: (candidate: CandidateItem) => boolean;
  }): CandidateItem | null {
    for (const candidate of params.candidates) {
      if (params.selectedSet.has(candidate)) {
        continue;
      }
      if (params.predicate && !params.predicate(candidate)) {
        continue;
      }
      const source = cleanText(candidate.sourceName || '').toLowerCase();
      const count = params.selectedSourceCounts.get(source) ?? 0;
      if (count >= SOURCE_MAX_PER_OUTLET) {
        continue;
      }
      return candidate;
    }
    return null;
  }

  private findRemovableCandidate(
    selected: CandidateItem[],
    selectedBucketCounts: Map<string, number>,
    targetByBucket: Map<string, number>,
    protectedBucket?: string,
  ): CandidateItem | null {
    const candidates = [...selected].sort((a, b) => a.score - b.score);
    for (const candidate of candidates) {
      if (candidate.isBreaking) {
        continue;
      }
      const bucket = this.inferBalanceBucket(candidate);
      if (protectedBucket && bucket === protectedBucket) {
        continue;
      }
      const count = selectedBucketCounts.get(bucket) ?? 0;
      const target = targetByBucket.get(bucket) ?? 0;
      if (count > target) {
        return candidate;
      }
    }
    if (protectedBucket) {
      const fallback = candidates.find((candidate) => {
        if (candidate.isBreaking) {
          return false;
        }
        return this.inferBalanceBucket(candidate) !== protectedBucket;
      });
      if (fallback) {
        return fallback;
      }
    }
    return candidates.find((candidate) => !candidate.isBreaking) ?? null;
  }

  private findLowestFromBucket(
    selected: CandidateItem[],
    bucket: string,
  ): CandidateItem | null {
    const inBucket = selected
      .filter((item) => this.inferBalanceBucket(item) === bucket)
      .sort((a, b) => a.score - b.score);
    return inBucket.find((item) => !item.isBreaking) ?? inBucket[0] ?? null;
  }

  private swapSelectedItem(params: {
    selected: CandidateItem[];
    removed: CandidateItem;
    added: CandidateItem;
    selectedSet: Set<CandidateItem>;
    selectedBucketCounts: Map<string, number>;
    selectedSourceCounts: Map<string, number>;
  }): void {
    const removeIndex = params.selected.indexOf(params.removed);
    if (removeIndex < 0) {
      return;
    }
    params.selected[removeIndex] = params.added;
    params.selectedSet.delete(params.removed);
    params.selectedSet.add(params.added);

    const removedBucket = this.inferBalanceBucket(params.removed);
    const addedBucket = this.inferBalanceBucket(params.added);
    params.selectedBucketCounts.set(
      removedBucket,
      Math.max(0, (params.selectedBucketCounts.get(removedBucket) ?? 0) - 1),
    );
    params.selectedBucketCounts.set(
      addedBucket,
      (params.selectedBucketCounts.get(addedBucket) ?? 0) + 1,
    );

    const removedSource = cleanText(
      params.removed.sourceName || '',
    ).toLowerCase();
    const addedSource = cleanText(params.added.sourceName || '').toLowerCase();
    params.selectedSourceCounts.set(
      removedSource,
      Math.max(0, (params.selectedSourceCounts.get(removedSource) ?? 0) - 1),
    );
    params.selectedSourceCounts.set(
      addedSource,
      (params.selectedSourceCounts.get(addedSource) ?? 0) + 1,
    );
  }
}
