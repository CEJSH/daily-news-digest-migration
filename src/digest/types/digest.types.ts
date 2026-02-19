export type ImpactSignalLabel =
  | 'policy'
  | 'sanctions'
  | 'capex'
  | 'infra'
  | 'security'
  | 'earnings'
  | 'market-demand';

export interface ImpactSignal {
  label: ImpactSignalLabel;
  evidence: string;
}

export interface DigestItem {
  id: string;
  date: string;
  category: string;
  title: string;
  summary: string[];
  whyImportant: string;
  importanceRationale: string;
  impactSignals: ImpactSignal[];
  dedupeKey: string;
  clusterKey: string;
  matchedTo: string | null;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  readTimeSec: number;
  status: 'kept' | 'published' | 'merged' | 'dropped';
  importance: number;
  importanceRaw?: number;
  qualityLabel: 'ok' | 'low_quality';
  qualityReason: string;
  isBriefing: boolean;
  isBreaking?: boolean;
  isCarriedOver?: boolean;
  dropReason?: string;
}

export interface DailyDigest {
  date: string;
  selectionCriteria: string;
  editorNote: string;
  question: string;
  lastUpdatedAt: string;
  items: DigestItem[];
}

export interface RssSource {
  topic: string;
  url: string;
  limit: number;
  freshnessWindow?: string;
}

export interface RssEntry {
  title: string;
  link: string;
  summary: string;
  sourceName: string;
  publishedAt: string;
}

export interface CandidateItem {
  title: string;
  link: string;
  summary: string;
  fullText?: string;
  topic: string;
  sourceName: string;
  sourceRaw: string;
  sourceNormalized?: string;
  publishedAt: string;
  ageHours: number | null;
  impactSignals: ImpactSignalLabel[];
  score: number;
  dedupeKey: string;
  clusterKey: string;
  readTimeSec: number;
  matchedTo: string | null;
  isBreaking?: boolean;
  status?: 'kept' | 'merged' | 'dropped';
  dropReason?: string;
  mergeReason?: string;
  ai?: AiEnrichmentResult;
  aiImportance?: number;
  aiImportanceRaw?: number;
  aiCategory?: string;
  aiQuality?: 'ok' | 'low_quality';
}

export interface AiImpactSignal {
  label: ImpactSignalLabel;
  evidence: string;
}

export interface AiEnrichmentResult {
  titleKo: string;
  summaryLines: string[];
  whyImportant: string;
  importanceRationale: string;
  dedupeKey: string;
  importanceScore: number;
  importanceRawScore: number;
  impactSignals: AiImpactSignal[];
  categoryLabel: string;
  qualityLabel: 'ok' | 'low_quality';
  qualityReason: string;
  qualityTags: string[];
}

export interface DigestMetrics {
  type: 'metrics_summary';
  date: string;
  totalIn: number;
  totalOut: number;
  dropped: number;
  dropReasons: Record<string, number>;
  impactLabels: Record<string, number>;
  sources: Record<string, number>;
  topicStats?: Record<
    string,
    {
      in: number;
      out: number;
      dropped: number;
    }
  >;
  sourceDropReasons?: Record<string, Record<string, number>>;
  breakingSelection?: {
    candidates: number;
    selected: number;
    selectionRate: number;
    selectedShare: number;
  };
  categories: Record<string, number>;
  importanceDistribution: Record<string, number>;
  topDiversity: {
    uniqueSources: number;
    uniqueCategories: number;
    maxPerSource: number;
  };
}
