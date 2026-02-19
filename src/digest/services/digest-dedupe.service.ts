import { Injectable } from '@nestjs/common';
import {
  DEDUPE_CLUSTER_DOMAINS,
  DEDUPE_CLUSTER_RELATIONS,
  DEDUPE_EVENT_TOKENS,
  DEDUPE_NGRAM_SIM,
  SOURCE_MAX_PER_OUTLET,
  STOPWORDS,
  TITLE_DEDUPE_JACCARD,
} from '../config/digest.constants';
import { CandidateItem } from '../types/digest.types';
import { jaccard, ngramSet } from '../utils/similarity.util';
import { tokenizeForDedupe } from '../utils/text.util';

@Injectable()
export class DigestDedupeService {
  buildDedupeKey(title: string, summary: string): string {
    const titleTokens = this.normalizeTokens(title);
    const summaryTokens = this.normalizeTokens(summary);
    const merged = Array.from(
      new Set([...titleTokens, ...summaryTokens]),
    ).slice(0, 8);
    if (merged.length === 0) {
      return 'news';
    }
    return merged.sort().join('-');
  }

  buildClusterKey(dedupeKey: string, title: string, summary: string): string {
    const tokens = this.normalizeTokens(`${dedupeKey} ${title} ${summary}`);
    if (tokens.length === 0) {
      return '';
    }

    const relationLabel = this.detectRelation(tokens);
    const domainLabel = this.detectDomain(tokens);
    const entity =
      tokens.find((token) => !DEDUPE_EVENT_TOKENS.has(token)) ?? tokens[0];

    const parts = [relationLabel, domainLabel, entity]
      .filter(Boolean)
      .slice(0, 3);
    return parts.join('/');
  }

  isTitleDuplicate(currentTitle: string, seenTitles: string[]): boolean {
    const currentTokens = new Set(this.normalizeTokens(currentTitle));
    if (currentTokens.size === 0) {
      return false;
    }

    for (const seenTitle of seenTitles) {
      const seenTokens = new Set(this.normalizeTokens(seenTitle));
      if (seenTokens.size === 0) {
        continue;
      }
      if (jaccard(currentTokens, seenTokens) >= TITLE_DEDUPE_JACCARD) {
        return true;
      }
    }

    return false;
  }

  isNearDuplicateByKey(currentKey: string, existingKeys: string[]): boolean {
    const currentNgrams = ngramSet(currentKey, 2);
    if (currentNgrams.size === 0) {
      return false;
    }

    for (const key of existingKeys) {
      const score = jaccard(currentNgrams, ngramSet(key, 2));
      if (score >= DEDUPE_NGRAM_SIM) {
        return true;
      }
    }
    return false;
  }

  pickTopWithDiversity(
    allItems: CandidateItem[],
    limit: number,
  ): CandidateItem[] {
    const sorted = [...allItems].sort((a, b) => b.score - a.score);
    const picked: CandidateItem[] = [];
    const sourceCounts = new Map<string, number>();

    for (const item of sorted) {
      if (picked.length >= limit) {
        break;
      }
      const count = sourceCounts.get(item.sourceName) ?? 0;
      const maxPerSource = item.sourceName ? SOURCE_MAX_PER_OUTLET : 3;
      if (count >= maxPerSource) {
        continue;
      }
      picked.push(item);
      sourceCounts.set(item.sourceName, count + 1);
    }

    if (picked.length < limit) {
      const fallback = sorted.filter((item) => !picked.includes(item));
      picked.push(...fallback.slice(0, limit - picked.length));
    }

    return picked;
  }

  private normalizeTokens(value: string): string[] {
    return tokenizeForDedupe(value)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= (/[가-힣]/.test(token) ? 2 : 3))
      .filter((token) => !STOPWORDS.has(token))
      .filter((token) => !/^\d+$/.test(token));
  }

  private detectDomain(tokens: string[]): string {
    const tokenSet = new Set(tokens);
    for (const [domain, keywords] of Object.entries(DEDUPE_CLUSTER_DOMAINS)) {
      for (const keyword of keywords) {
        if (tokenSet.has(keyword.toLowerCase())) {
          return domain;
        }
      }
    }
    return '';
  }

  private detectRelation(tokens: string[]): string {
    const tokenSet = new Set(tokens);
    for (const [label, required] of Object.entries(DEDUPE_CLUSTER_RELATIONS)) {
      let matched = true;
      for (const token of required) {
        if (!tokenSet.has(token.toLowerCase())) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return label;
      }
    }
    return '';
  }
}
