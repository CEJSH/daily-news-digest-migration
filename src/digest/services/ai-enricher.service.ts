import { Injectable } from '@nestjs/common';
import {
  AI_INPUT_MAX_CHARS,
  IMPACT_SIGNALS_MAP,
} from '../config/digest.constants';
import { SYSTEM_PROMPT } from '../prompts/digest.prompt';
import {
  AiEnrichmentResult,
  CandidateItem,
  ImpactSignalLabel,
} from '../types/digest.types';
import { cleanText, splitSummaryToLines } from '../utils/text.util';
import { DigestScoringService } from './digest-scoring.service';
import { LlmClientService } from './llm-client.service';

const ALLOWED_LABELS: ImpactSignalLabel[] = [
  'policy',
  'sanctions',
  'capex',
  'infra',
  'security',
  'earnings',
  'market-demand',
];

const CATEGORY_LABELS = new Set([
  '경제',
  '산업',
  '기술',
  '금융',
  '정책',
  '국제',
  '사회',
  '라이프',
  '헬스',
  '환경',
  '에너지',
  '모빌리티',
]);

const CATEGORY_ALIASES: Record<string, string> = {
  world: '국제',
  geopolitics: '국제',
  global: '국제',
  국제정세: '국제',
  tech: '기술',
  it: '기술',
  ai: '기술',
  technology: '기술',
  business: '경제',
  economy: '경제',
  finance: '금융',
  politics: '정책',
  regulation: '정책',
  policy: '정책',
  health: '헬스',
  life: '라이프',
  society: '사회',
  mobility: '모빌리티',
  energy: '에너지',
  environment: '환경',
  industry: '산업',
};

@Injectable()
export class AiEnricherService {
  constructor(
    private readonly llmClient: LlmClientService,
    private readonly scoringService: DigestScoringService,
  ) {}

  async enrichItem(
    candidate: CandidateItem,
  ): Promise<AiEnrichmentResult | null> {
    const title = cleanText(candidate.title);
    const summary = cleanText(candidate.summary);
    const fullText = cleanText(candidate.fullText || '').slice(0, 6000);

    const inputText = fullText || summary;
    if (!inputText) {
      return null;
    }

    const aiHints = candidate.impactSignals.join(', ');
    const textForSignalDetect = `${title} ${summary} ${fullText}`.toLowerCase();
    const candidates =
      this.ruleBasedImpactSignalCandidates(textForSignalDetect);

    const userPrompt = [
      `Title: ${title}`,
      `ImpactSignalsHint: ${aiHints}`,
      `ImpactSignalCandidates: ${candidates.join(', ')}`,
      `Text: ${inputText.slice(0, AI_INPUT_MAX_CHARS)}`,
      'Return only JSON.',
    ].join('\n');

    const payload = await this.llmClient.generateJson(
      SYSTEM_PROMPT,
      userPrompt,
    );
    if (!payload) {
      return null;
    }

    const titleKo = cleanText(this.asString(payload.title_ko) || title);
    const summaryLines = this.normalizeSummaryLines(
      payload.summary_lines,
      titleKo,
      summary,
    );
    const whyImportant =
      cleanText(this.asString(payload.why_important)) ||
      this.fallbackWhyImportant(candidate.impactSignals);

    let importanceRationale = cleanText(
      this.asString(payload.importance_rationale),
    );
    if (importanceRationale && !importanceRationale.startsWith('근거:')) {
      importanceRationale = `근거: ${importanceRationale}`;
    }
    if (!importanceRationale) {
      importanceRationale =
        '근거: 본문 근거가 제한적이어서 보수적으로 중요도를 산정했습니다.';
    }

    const dedupeKey = cleanText(
      this.asString(payload.dedupe_key) || candidate.dedupeKey,
    );
    let { importanceScore, importanceRawScore } = this.normalizeImportance({
      raw: payload.importance_score ?? payload.importance,
      candidate,
    });

    const impactSignals = this.normalizeImpactSignals(
      payload.impact_signals,
      inputText,
    );

    const qualityLabelRaw = cleanText(
      this.asString(payload.quality_label) || 'ok',
    ).toLowerCase();
    const qualityLabel =
      qualityLabelRaw === 'low_quality' ? 'low_quality' : 'ok';
    const qualityReason = cleanText(
      this.asString(payload.quality_reason) || '정보성 기사',
    );
    const qualityTags = this.normalizeStringArray(payload.quality_tags, 6);

    const categoryRaw = cleanText(this.asString(payload.category_label));
    const categoryLabel = this.resolveCategoryLabel(
      categoryRaw,
      candidate,
      title,
      summary,
    );

    if (qualityLabel === 'low_quality') {
      importanceScore = this.scoringService.normalizeDisplayImportance(
        Math.min(2, importanceScore),
      );
      importanceRawScore =
        this.scoringService.displayToRawImportance(importanceScore);
    }

    return {
      titleKo,
      summaryLines,
      whyImportant,
      importanceRationale,
      dedupeKey,
      importanceScore,
      importanceRawScore,
      impactSignals,
      categoryLabel,
      qualityLabel,
      qualityReason,
      qualityTags,
    };
  }

  private normalizeImpactSignals(raw: unknown, evidenceText: string) {
    if (!Array.isArray(raw)) {
      return [];
    }

    const out: { label: ImpactSignalLabel; evidence: string }[] = [];
    const used = new Set<ImpactSignalLabel>();

    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const label = cleanText(
        this.asString(record.label),
      ).toLowerCase() as ImpactSignalLabel;
      if (!ALLOWED_LABELS.includes(label)) {
        continue;
      }
      if (used.has(label)) {
        continue;
      }

      const evidence = cleanText(this.asString(record.evidence)).slice(0, 280);
      if (!evidence) {
        continue;
      }

      out.push({ label, evidence });
      used.add(label);
      if (out.length >= 2) {
        break;
      }
    }

    if (out.length > 0) {
      return out;
    }

    // fallback: rule-based 신호를 evidence로 구성
    const text = evidenceText.toLowerCase();
    for (const label of ALLOWED_LABELS) {
      const keywords = IMPACT_SIGNALS_MAP[label];
      const hit = keywords.find((keyword) =>
        text.includes(keyword.toLowerCase()),
      );
      if (!hit) {
        continue;
      }
      const excerpt = this.findEvidenceExcerpt(evidenceText, hit);
      out.push({
        label,
        evidence: excerpt || `본문에서 ${hit} 관련 근거가 확인되었습니다.`,
      });
      if (out.length >= 2) {
        break;
      }
    }
    return out;
  }

  private findEvidenceExcerpt(text: string, keyword: string): string {
    const source = cleanText(text || '');
    if (!source) {
      return '';
    }

    const sentences = source
      .split(/(?<=[.!?。])\s+|\n+/g)
      .map((line) => cleanText(line))
      .filter(Boolean);
    const target = keyword.toLowerCase();

    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(target)) {
        return sentence.slice(0, 280);
      }
    }

    return source.slice(0, 280);
  }

  private normalizeSummaryLines(
    raw: unknown,
    title: string,
    fallbackSummary: string,
  ): string[] {
    const lines = this.normalizeStringArray(raw, 3)
      .map((line) => cleanText(line))
      .filter((line) => line.length > 0)
      .filter((line) => line !== title);

    if (lines.length > 0) {
      return lines.slice(0, 3);
    }

    return splitSummaryToLines(fallbackSummary).slice(0, 3);
  }

  private normalizeImportance(params: {
    raw: unknown;
    candidate: CandidateItem;
  }): { importanceScore: number; importanceRawScore: number } {
    const fallbackRaw = this.scoringService.inferImportanceRaw(
      params.candidate,
    );
    const parsed = Number(params.raw);
    if (!Number.isFinite(parsed)) {
      return {
        importanceScore:
          this.scoringService.rawToDisplayImportance(fallbackRaw),
        importanceRawScore: fallbackRaw,
      };
    }

    if (parsed > 5) {
      const rawScore = Math.max(0, Math.min(100, Math.round(parsed)));
      return {
        importanceScore: this.scoringService.rawToDisplayImportance(rawScore),
        importanceRawScore: rawScore,
      };
    }

    const display = this.scoringService.normalizeDisplayImportance(parsed);
    return {
      importanceScore: display,
      importanceRawScore: this.scoringService.displayToRawImportance(display),
    };
  }

  private fallbackWhyImportant(impactSignals: ImpactSignalLabel[]): string {
    if (impactSignals.length === 0) {
      return '구조적 영향 가능성이 있어 모니터링이 필요한 이슈입니다.';
    }

    const map: Record<ImpactSignalLabel, string> = {
      policy: '정책/규제 변화는 산업 의사결정에 직접적인 영향을 줍니다.',
      sanctions: '제재 이슈는 공급망과 거래 리스크를 바꿀 수 있습니다.',
      capex: '설비투자는 중장기 수급과 경쟁구도 변화에 연결됩니다.',
      infra: '인프라 변화는 운영 안정성과 비용에 즉시 영향을 줍니다.',
      security: '보안 이슈는 운영 리스크와 대응 비용을 크게 높일 수 있습니다.',
      earnings: '실적 변화는 업황과 투자심리의 선행 신호가 될 수 있습니다.',
      'market-demand': '수요 변화는 시장 방향성을 판단하는 핵심 단서입니다.',
    };

    return map[impactSignals[0]];
  }

  private ruleBasedImpactSignalCandidates(text: string): string[] {
    const out: string[] = [];
    for (const label of ALLOWED_LABELS) {
      const keywords = IMPACT_SIGNALS_MAP[label];
      if (keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
        out.push(label);
      }
    }
    return out.slice(0, 5);
  }

  private normalizeStringArray(raw: unknown, limit: number): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    const out: string[] = [];
    for (const value of raw) {
      if (typeof value !== 'string') {
        continue;
      }
      const cleaned = cleanText(value);
      if (!cleaned) {
        continue;
      }
      if (!out.includes(cleaned)) {
        out.push(cleaned);
      }
      if (out.length >= limit) {
        break;
      }
    }
    return out;
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private resolveCategoryLabel(
    categoryRaw: string,
    candidate: CandidateItem,
    title: string,
    summary: string,
  ): string {
    if (CATEGORY_LABELS.has(categoryRaw)) {
      return categoryRaw;
    }

    const aliasKey = categoryRaw.toLowerCase().replace(/[\s_/]+/g, '');
    const alias = CATEGORY_ALIASES[aliasKey];
    if (alias && CATEGORY_LABELS.has(alias)) {
      return alias;
    }

    const mapped = this.scoringService.mapTopicToCategory(
      `${candidate.topic} ${title} ${summary}`,
    );
    if (CATEGORY_LABELS.has(mapped)) {
      return mapped;
    }

    return '국제';
  }
}
