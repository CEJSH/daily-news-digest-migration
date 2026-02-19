import { Injectable, Logger } from '@nestjs/common';
import {
  AI_ENRICH_ENABLED,
  AI_IMPORTANCE_ENABLED,
  AI_IMPORTANCE_MAX_ITEMS,
  AI_IMPORTANCE_WEIGHT,
  AI_SEMANTIC_DEDUPE_ENABLED,
  AI_SEMANTIC_DEDUPE_MAX_ITEMS,
  AI_SEMANTIC_DEDUPE_THRESHOLD,
  ARTICLE_FETCH_ENABLED,
  ARTICLE_FETCH_MAX_ITEMS,
  ARTICLE_FETCH_MIN_CHARS,
  ARTICLE_FETCH_TIMEOUT_SEC,
} from '../config/digest.constants';
import { CandidateItem } from '../types/digest.types';
import { cleanText } from '../utils/text.util';
import { AiEnricherService } from './ai-enricher.service';
import { LlmClientService } from './llm-client.service';

@Injectable()
export class DigestAiService {
  private readonly logger = new Logger(DigestAiService.name);
  private static readonly PROGRESS_INTERVAL = 5;

  constructor(
    private readonly aiEnricher: AiEnricherService,
    private readonly llmClient: LlmClientService,
  ) {}

  async applyAiImportance(items: CandidateItem[]): Promise<void> {
    if (!AI_IMPORTANCE_ENABLED || items.length === 0) {
      return;
    }

    const target = [...items]
      .filter((item) => item.status !== 'dropped' && item.status !== 'merged')
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(items.length, AI_IMPORTANCE_MAX_ITEMS));
    const startedAt = Date.now();
    this.logger.log(`ai importance start: target=${target.length}`);

    await this.prefetchFullText(target);

    let enriched = 0;
    for (let i = 0; i < target.length; i += 1) {
      const item = target[i];
      const ai = await this.aiEnricher.enrichItem(item);
      if (!ai) {
        if (this.shouldLogProgress(i + 1, target.length)) {
          this.logger.log(
            `ai importance progress: ${i + 1}/${target.length} enriched=${enriched}`,
          );
        }
        continue;
      }
      item.ai = ai;
      item.aiImportance = ai.importanceScore;
      item.aiImportanceRaw = ai.importanceRawScore;
      item.aiCategory = ai.categoryLabel;
      item.aiQuality = ai.qualityLabel;

      if (ai.impactSignals.length > 0) {
        item.impactSignals = ai.impactSignals.map((signal) => signal.label);
      }

      if (ai.dedupeKey) {
        item.dedupeKey = ai.dedupeKey;
      }

      const weightedImportance =
        (ai.importanceRawScore / 20) * AI_IMPORTANCE_WEIGHT;
      item.score = Number((item.score + weightedImportance).toFixed(4));
      enriched += 1;
      if (this.shouldLogProgress(i + 1, target.length)) {
        this.logger.log(
          `ai importance progress: ${i + 1}/${target.length} enriched=${enriched}`,
        );
      }
    }
    this.logger.log(
      `ai importance done: target=${target.length} enriched=${enriched} elapsedMs=${Date.now() - startedAt}`,
    );
  }

  async applySemanticDedupe(items: CandidateItem[]): Promise<CandidateItem[]> {
    if (!AI_SEMANTIC_DEDUPE_ENABLED || items.length === 0) {
      return items;
    }

    const target = [...items]
      .filter((item) => item.status !== 'dropped' && item.status !== 'merged')
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(items.length, AI_SEMANTIC_DEDUPE_MAX_ITEMS));
    const startedAt = Date.now();
    this.logger.log(`semantic dedupe start: target=${target.length}`);

    const kept: Array<{ item: CandidateItem; embedding: number[] }> = [];
    let merged = 0;

    for (let i = 0; i < target.length; i += 1) {
      const item = target[i];
      const text = this.embeddingText(item);
      if (!text) {
        if (this.shouldLogProgress(i + 1, target.length)) {
          this.logger.log(
            `semantic dedupe progress: ${i + 1}/${target.length} merged=${merged}`,
          );
        }
        continue;
      }
      const embedding = await this.llmClient.getEmbedding(text);
      if (!embedding) {
        if (this.shouldLogProgress(i + 1, target.length)) {
          this.logger.log(
            `semantic dedupe progress: ${i + 1}/${target.length} merged=${merged}`,
          );
        }
        continue;
      }

      let duplicateOf: CandidateItem | null = null;
      for (const prev of kept) {
        const similarity = this.cosineSimilarity(embedding, prev.embedding);
        if (similarity >= AI_SEMANTIC_DEDUPE_THRESHOLD) {
          duplicateOf = prev.item;
          break;
        }
      }

      if (duplicateOf) {
        item.status = 'merged';
        item.mergeReason = 'semantic_duplicate';
        item.matchedTo = duplicateOf.dedupeKey || duplicateOf.title;
        merged += 1;
      } else {
        kept.push({ item, embedding });
      }
      if (this.shouldLogProgress(i + 1, target.length)) {
        this.logger.log(
          `semantic dedupe progress: ${i + 1}/${target.length} merged=${merged}`,
        );
      }
    }

    const filtered = items.filter(
      (item) => item.status !== 'merged' && item.status !== 'dropped',
    );
    if (filtered.length !== items.length) {
      this.logger.log(
        `semantic dedupe merged ${items.length - filtered.length} items`,
      );
    }
    this.logger.log(
      `semantic dedupe done: target=${target.length} merged=${merged} elapsedMs=${Date.now() - startedAt}`,
    );
    return filtered;
  }

  async enrichSelectedItems(items: CandidateItem[]): Promise<void> {
    if (!AI_ENRICH_ENABLED || items.length === 0) {
      return;
    }
    const startedAt = Date.now();
    this.logger.log(`ai enrich selected start: target=${items.length}`);

    await this.prefetchFullText(items);

    let enriched = 0;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.ai) {
        if (this.shouldLogProgress(i + 1, items.length)) {
          this.logger.log(
            `ai enrich selected progress: ${i + 1}/${items.length} enriched=${enriched}`,
          );
        }
        continue;
      }
      const ai = await this.aiEnricher.enrichItem(item);
      if (!ai) {
        if (this.shouldLogProgress(i + 1, items.length)) {
          this.logger.log(
            `ai enrich selected progress: ${i + 1}/${items.length} enriched=${enriched}`,
          );
        }
        continue;
      }
      item.ai = ai;
      item.aiImportance = ai.importanceScore;
      item.aiImportanceRaw = ai.importanceRawScore;
      item.aiCategory = ai.categoryLabel;
      item.aiQuality = ai.qualityLabel;
      if (ai.impactSignals.length > 0) {
        item.impactSignals = ai.impactSignals.map((signal) => signal.label);
      }
      if (ai.dedupeKey) {
        item.dedupeKey = ai.dedupeKey;
      }
      enriched += 1;
      if (this.shouldLogProgress(i + 1, items.length)) {
        this.logger.log(
          `ai enrich selected progress: ${i + 1}/${items.length} enriched=${enriched}`,
        );
      }
    }
    this.logger.log(
      `ai enrich selected done: target=${items.length} enriched=${enriched} elapsedMs=${Date.now() - startedAt}`,
    );
  }

  async prefetchFullText(items: CandidateItem[]): Promise<void> {
    if (!ARTICLE_FETCH_ENABLED || items.length === 0) {
      return;
    }

    const target = items.slice(
      0,
      Math.min(items.length, ARTICLE_FETCH_MAX_ITEMS),
    );
    const startedAt = Date.now();
    this.logger.log(
      `fulltext prefetch start: target=${target.length} timeoutSec=${ARTICLE_FETCH_TIMEOUT_SEC}`,
    );
    let fetchedCount = 0;
    for (let i = 0; i < target.length; i += 1) {
      const item = target[i];
      if ((item.fullText?.length ?? 0) >= ARTICLE_FETCH_MIN_CHARS) {
        if (this.shouldLogProgress(i + 1, target.length)) {
          this.logger.log(
            `fulltext prefetch progress: ${i + 1}/${target.length} fetched=${fetchedCount}`,
          );
        }
        continue;
      }

      const fetched = await this.fetchArticleText(item.link);
      if (fetched && fetched.length >= ARTICLE_FETCH_MIN_CHARS) {
        item.fullText = fetched;
        fetchedCount += 1;
      }
      if (this.shouldLogProgress(i + 1, target.length)) {
        this.logger.log(
          `fulltext prefetch progress: ${i + 1}/${target.length} fetched=${fetchedCount}`,
        );
      }
    }
    this.logger.log(
      `fulltext prefetch done: target=${target.length} fetched=${fetchedCount} elapsedMs=${Date.now() - startedAt}`,
    );
  }

  private async fetchArticleText(url: string): Promise<string> {
    if (!url) {
      return '';
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      ARTICLE_FETCH_TIMEOUT_SEC * 1000,
    );
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'daily-news-digest-nest/1.0',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        return '';
      }

      const html = await res.text();
      return this.extractTextFromHtml(html);
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractTextFromHtml(html: string): string {
    if (!html) {
      return '';
    }

    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch?.[1] ?? html;

    const stripped = body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleanText(stripped);
  }

  private embeddingText(item: CandidateItem): string {
    const aiSummary = item.ai?.summaryLines?.join(' ') ?? '';
    const fullText = item.fullText ?? '';
    return cleanText(
      `${item.title} ${item.summary} ${aiSummary} ${fullText}`,
    ).slice(0, 1600);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private shouldLogProgress(done: number, total: number): boolean {
    return done === total || done % DigestAiService.PROGRESS_INTERVAL === 0;
  }
}
