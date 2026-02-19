import path from 'node:path';
import { ImpactSignalLabel } from '../types/digest.types';

export const NEWSLETTER_TITLE = '🚀 DAILY WORLD – AI & Tech 일일 요약';
export const SELECTION_CRITERIA =
  '① 내일도 영향이 남는 이슈 ② 과도한 감정 소모 제외 ③ 어제와 중복되는 뉴스 제외';
export const EDITOR_NOTE =
  '이 뉴스는 클릭 수가 아니라 오늘 이후에도 남는 정보만 기준으로 편집했습니다.';
export const QUESTION_OF_THE_DAY =
  '정보를 덜 보는 것이 오히려 더 똑똑한 소비일까?';

export const TOP_LIMIT = Number(process.env.TOP_LIMIT ?? 20);
export const MIN_TOP_ITEMS = Number(process.env.MIN_TOP_ITEMS ?? 5);
export const TITLE_DEDUPE_JACCARD = Number(
  process.env.TITLE_DEDUPE_JACCARD ?? 0.55,
);
export const DEDUPE_NGRAM_SIM = Number(process.env.DEDUPKEY_NGRAM_SIM ?? 0.35);
export const DEDUPE_RECENT_DAYS = Number(process.env.DEDUPE_RECENT_DAYS ?? 3);
export const SOURCE_MAX_PER_OUTLET = Number(
  process.env.TOP_SOURCE_MAX_PER_OUTLET ?? 2,
);
const breakingSlotsRaw = Number(process.env.BREAKING_MIN_SLOTS ?? 1);
export const BREAKING_MIN_SLOTS = Number.isFinite(breakingSlotsRaw)
  ? Math.max(0, Math.floor(breakingSlotsRaw))
  : 1;
const breakingScoreBoostRaw = Number(process.env.BREAKING_SCORE_BOOST ?? 0.6);
export const BREAKING_SCORE_BOOST = Number.isFinite(breakingScoreBoostRaw)
  ? Math.max(0, breakingScoreBoostRaw)
  : 0.6;
const sourceDropNotSelectedTopNRaw = Number(
  process.env.SOURCE_DROP_NOT_SELECTED_TOP_N ?? 30,
);
export const SOURCE_DROP_NOT_SELECTED_TOP_N = Number.isFinite(
  sourceDropNotSelectedTopNRaw,
)
  ? Math.max(0, Math.floor(sourceDropNotSelectedTopNRaw))
  : 30;
export const TOP_CATEGORY_BALANCE_ENABLED =
  process.env.TOP_CATEGORY_BALANCE_ENABLED !== '0';
const topCategoryMaxShareRaw = Number(
  process.env.TOP_CATEGORY_MAX_SHARE ?? 0.35,
);
export const TOP_CATEGORY_MAX_SHARE = Number.isFinite(topCategoryMaxShareRaw)
  ? Math.max(0.2, Math.min(1, topCategoryMaxShareRaw))
  : 0.35;

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
export const OUTPUT_JSON =
  process.env.OUTPUT_JSON ?? path.join(dataDir, 'daily_digest.json');
export const METRICS_JSON =
  process.env.METRICS_JSON ?? path.join(dataDir, 'digest_metrics.json');
export const DEDUPE_HISTORY_PATH =
  process.env.DEDUPE_HISTORY_PATH ?? path.join(dataDir, 'dedupe_history.json');

export const HARD_EXCLUDE_KEYWORDS = [
  '동향',
  '동향리포트',
  '리포트',
  '칼럼',
  '오피니언',
  '사설',
  '기고',
  '백서',
  '자료집',
  '세미나',
  '웨비나',
  '컨퍼런스',
  '포럼',
  '행사',
  '모집',
  '신청',
  '홍보',
  'promotion',
  'whitepaper',
  'report',
  'webinar',
  'conference',
  'forum',
  'opinion',
  'editorial',
  'op-ed',
];

export const HARD_EXCLUDE_URL_HINTS = [
  '/report',
  '/whitepaper',
  '/webinar',
  '/seminar',
  '/conference',
  '/event',
  '/download',
];

export const EXCLUDE_KEYWORDS = [
  '연예',
  '아이돌',
  '배우',
  '가수',
  '예능',
  '드라마',
  '영화',
  '야구',
  '축구',
  '농구',
  '골프',
  '살인',
  '폭행',
  '성폭행',
  '맛집',
  '여행기',
  '경악',
  '충격',
  'entertainment',
  'celebrity',
  'baseball',
  'soccer',
  'movie',
  'drama',
  'murder',
  'assault',
  'restaurant',
  'travel',
];

export const EMOTIONAL_DROP_KEYWORDS = ['참사', '충격', '분노', '논란', '폭로'];

export const SOURCE_TIER_A = new Set([
  'Reuters',
  'Bloomberg',
  'Financial Times',
  'The Wall Street Journal',
  'WSJ',
  'The Economist',
  'CNBC',
  'AP',
  'AFP',
  'The New York Times',
  'NYT',
  'Ars Technica',
  '연합뉴스',
  '한국경제',
  '매일경제',
  '서울경제',
]);

export const SOURCE_TIER_B = new Set([
  '중앙일보',
  '동아일보',
  'MBC',
  'SBS',
  'KBS',
  'YTN',
  '조선일보',
  '한겨레',
  '경향신문',
  '머니투데이',
  '이데일리',
  '전자신문',
  'ZDNet Korea',
  'TechCrunch',
  'The Verge',
  'MIT Technology Review',
  'Semafor',
  '디일렉',
]);

export const LONG_IMPACT_SIGNALS = new Set<ImpactSignalLabel>([
  'policy',
  'sanctions',
  'earnings',
  'security',
]);

const DEFAULT_TOP_FRESH_EXCEPT_SIGNALS: ImpactSignalLabel[] = [
  'policy',
  'sanctions',
  'earnings',
  'capex',
  'infra',
  'security',
  'market-demand',
];

function parseImpactSignalCsvEnv(
  envName: string,
  fallback: ImpactSignalLabel[],
): ImpactSignalLabel[] {
  const raw = (process.env[envName] ?? '').trim();
  if (!raw) {
    return fallback;
  }
  const tokens = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allowed: ImpactSignalLabel[] = [
    'policy',
    'sanctions',
    'capex',
    'infra',
    'security',
    'earnings',
    'market-demand',
  ];
  return tokens.filter((token): token is ImpactSignalLabel =>
    allowed.includes(token as ImpactSignalLabel),
  );
}

export const TOP_FRESH_MAX_HOURS = Number(
  process.env.TOP_FRESH_MAX_HOURS ?? 84,
);
export const TOP_FRESH_EXCEPT_MAX_HOURS = Number(
  process.env.TOP_FRESH_EXCEPT_MAX_HOURS ?? 168,
);
export const TOP_FRESH_EXCEPT_SIGNALS = new Set<ImpactSignalLabel>(
  parseImpactSignalCsvEnv(
    'TOP_FRESH_EXCEPT_SIGNALS',
    DEFAULT_TOP_FRESH_EXCEPT_SIGNALS,
  ),
);

export const IMPACT_SIGNALS_MAP: Record<ImpactSignalLabel, string[]> = {
  policy: [
    'bill',
    'law',
    'amendment',
    'regulation',
    'rule',
    'policy',
    'guideline',
    'government',
    'tariff',
    'trade',
    'negotiation',
    'agreement',
    '법안',
    '개정',
    '시행령',
    '규정',
    '규제',
    '국회',
    '정부',
    '관세',
    '무역',
    '협상',
    '협정',
  ],
  sanctions: [
    'sanction',
    'sanctions',
    'export control',
    'entity list',
    'embargo',
    'asset freeze',
    '수출통제',
    '블랙리스트',
    '자산 동결',
    '거래 금지',
    '금수',
  ],
  capex: [
    'capex',
    'expansion',
    'build',
    'construction',
    'plant',
    'factory',
    'line',
    'data center',
    'facility',
    'capacity',
    '증설',
    '설비',
    '시설',
    '공장',
    '데이터센터',
    '건설',
    '라인',
  ],
  infra: ['outage', 'downtime', 'disruption', '장애', '정전', '서비스 중단'],
  security: [
    'breach',
    'hack',
    'leak',
    'attack',
    'ransomware',
    'cve',
    'vulnerability',
    '침해',
    '해킹',
    '유출',
    '공격',
    '랜섬웨어',
    '취약점',
    '위협',
    '안보',
  ],
  earnings: [
    'earnings',
    'guidance',
    'consensus',
    'profit',
    'loss',
    'margin',
    'forecast',
    'outlook',
    'revenue',
    'quarter',
    'q1',
    'q2',
    'q3',
    'q4',
    '매출',
    '영업이익',
    '순이익',
    '실적',
    '컨센서스',
    '가이던스',
    '전망',
  ],
  'market-demand': [
    'sales',
    'demand',
    'deliveries',
    'shipments',
    'orders',
    'bookings',
    'inventory',
    'pricing',
    '판매',
    '수요',
    '출하',
    '주문',
    '예약',
    '재고',
    '가격',
    '유가',
  ],
};

export const IMPACT_SIGNAL_BASE_LEVELS: Record<ImpactSignalLabel, number> = {
  policy: 3,
  sanctions: 3,
  capex: 3,
  infra: 3,
  security: 3,
  earnings: 2,
  'market-demand': 2,
};

export const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'to',
  'for',
  'of',
  'and',
  'or',
  'in',
  'on',
  'with',
  'is',
  'are',
  '것',
  '수',
  '등',
  '및',
  '관련',
  '대한',
  '대해',
  '위해',
  '통해',
  '이번',
  '지난',
  '최근',
  '현재',
  '향후',
  '예상',
  '전망',
  '논의',
  '검토',
  '계획',
  '예정',
]);

export const DEDUPE_EVENT_TOKENS = new Set([
  'funding',
  'investment',
  'acquisition',
  'merger',
  'ipo',
  'earnings',
  'sanctions',
  'policy',
  'capex',
  'trade',
  'tariff',
  '투자',
  '인수',
  '합병',
  '상장',
  '실적',
  '제재',
  '정책',
  '관세',
]);

export const DEDUPE_CLUSTER_DOMAINS: Record<string, Set<string>> = {
  에너지: new Set([
    '에너지',
    '전력',
    '전력망',
    '원전',
    '천연가스',
    'energy',
    'power',
    'grid',
    'utility',
  ]),
  반도체: new Set(['반도체', 'hbm', '파운드리', 'euv', 'tsmc', '칩', 'chip']),
  ai: new Set([
    'ai',
    '인공지능',
    'llm',
    '모델',
    'gpu',
    'npu',
    'inference',
    'training',
  ]),
  클라우드: new Set([
    '클라우드',
    'cloud',
    '데이터센터',
    'datacenter',
    'aws',
    'azure',
    'gcp',
  ]),
  금융: new Set(['금융', '은행', '증권', '보험', 'bank', 'capital']),
  공급망: new Set(['공급망', '물류', '조달', 'supply chain', 'logistics']),
};

export const DEDUPE_CLUSTER_RELATIONS: Record<string, Set<string>> = {
  한미: new Set(['한국', '미국']),
  미중: new Set(['미국', '중국']),
  한중: new Set(['한국', '중국']),
  한일: new Set(['한국', '일본']),
  미일: new Set(['미국', '일본']),
  한EU: new Set(['한국', '유럽', 'eu', 'europe']),
  미EU: new Set(['미국', '유럽', 'eu', 'europe']),
};

export const KST_OFFSET_HOURS = 9;

export const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'gemini').toLowerCase();
export const AI_INPUT_MAX_CHARS = Number(
  process.env.AI_INPUT_MAX_CHARS ?? 4000,
);
export const AI_IMPORTANCE_ENABLED = process.env.AI_IMPORTANCE_ENABLED !== '0';
export const AI_IMPORTANCE_MAX_ITEMS = Number(
  process.env.AI_IMPORTANCE_MAX_ITEMS ?? 40,
);
export const AI_IMPORTANCE_WEIGHT = Number(
  process.env.AI_IMPORTANCE_WEIGHT ?? 1.0,
);
export const AI_ENRICH_ENABLED = process.env.AI_ENRICH_ENABLED !== '0';
export const AI_SEMANTIC_DEDUPE_ENABLED =
  process.env.AI_SEMANTIC_DEDUPE_ENABLED !== '0';
export const AI_SEMANTIC_DEDUPE_MAX_ITEMS = Number(
  process.env.AI_SEMANTIC_DEDUPE_MAX_ITEMS ?? 30,
);
export const AI_SEMANTIC_DEDUPE_THRESHOLD = Number(
  process.env.AI_SEMANTIC_DEDUPE_THRESHOLD ?? 0.88,
);
export const AI_EMBED_MAX_CHARS = Number(
  process.env.AI_EMBED_MAX_CHARS ?? 1200,
);

export const ARTICLE_FETCH_ENABLED = process.env.ARTICLE_FETCH_ENABLED !== '0';
export const ARTICLE_FETCH_MAX_ITEMS = Number(
  process.env.ARTICLE_FETCH_MAX_ITEMS ?? 12,
);
export const ARTICLE_FETCH_MIN_CHARS = Number(
  process.env.ARTICLE_FETCH_MIN_CHARS ?? 300,
);
export const ARTICLE_FETCH_TIMEOUT_SEC = Number(
  process.env.ARTICLE_FETCH_TIMEOUT_SEC ?? 6,
);

export const ALLOWED_IMPACT_LABELS = new Set<ImpactSignalLabel>([
  'policy',
  'sanctions',
  'capex',
  'infra',
  'security',
  'earnings',
  'market-demand',
]);

export const POLICY_STRONG_KEYWORDS = [
  '법안',
  '법률',
  '규제',
  '행정명령',
  '법 개정',
  '법개정',
  '정책 발표',
  '통과',
  '의결',
  '시행',
  '발효',
  '공포',
  '가이드라인',
  '지침',
  '인허가',
  '과징금',
  '감독',
  'policy announcement',
  'official policy',
  'regulation',
  'rule',
  'guideline',
  'law',
  'bill',
];
export const POLICY_GOV_KEYWORDS = [
  '정부',
  '외교',
  '국가',
  '당국',
  'diplomatic',
  'government',
  'state',
];
export const POLICY_NEGOTIATION_KEYWORDS = [
  '협상',
  '협의',
  '협정',
  '회담',
  '대화',
  'negotiation',
  'talks',
  'summit',
  'dialogue',
];
export const POLICY_TRADE_ONLY_KEYWORDS = [
  '협상',
  '협의',
  '협정',
  '회담',
  '대화',
  '관세',
  '무역',
  '무역전쟁',
  'trade',
  'tariff',
  'trade talks',
  'negotiation',
  'agreement',
  'summit',
  'dialogue',
];

export const SANCTIONS_EVIDENCE_KEYWORDS = [
  '제재',
  '동결',
  '거래 금지',
  '거래금지',
  '블랙리스트',
  '수출통제',
  'shadow fleet',
  'assets frozen',
  'sanction',
  'sanctions',
  'export control',
  'asset freeze',
];
export const MARKET_DEMAND_EVIDENCE_KEYWORDS = [
  '판매',
  '수요',
  '출하',
  '주문',
  '재고',
  '가격',
  '유가',
  'sales',
  'demand',
  'shipments',
  'deliveries',
  'orders',
  'inventory',
  'price',
  'oil price',
];
export const SECURITY_EVIDENCE_KEYWORDS = [
  '격추',
  '위협',
  '드론',
  '공격',
  '침해',
  '유조선',
  '해협 봉쇄',
  '해협봉쇄',
  'attack',
  'breach',
  'drone',
  'threat',
  'tanker',
  'strait blockade',
];
export const EARNINGS_METRIC_KEYWORDS = [
  '매출',
  '영업이익',
  '영업익',
  '순이익',
  '순손실',
  '실적',
  'revenue',
  'operating profit',
  'operating income',
  'net income',
  'net profit',
  'earnings',
  'ebit',
  'ebitda',
];
export const CAPEX_ACTION_KEYWORDS = [
  '설비투자',
  '투자',
  '투자 계획',
  '투자계획',
  '투자 발표',
  '증설',
  '라인',
  '공장',
  '데이터센터',
  '시설',
  '건설',
  '착공',
  'capex',
  'expansion',
  'build',
  'construction',
  'plant',
  'factory',
  'data center',
];
export const CAPEX_PLAN_KEYWORDS = [
  '계획',
  '발표',
  '착공',
  '건설',
  '설립',
  '확대',
  '증설',
  '추진',
  '예정',
  'plan',
  'announce',
  'start',
  'begin',
  'expand',
];
export const INFRA_KEYWORDS = [
  '장애',
  '정전',
  '서비스 중단',
  '중단',
  '복구',
  '전력망',
  '망 장애',
  '통신 장애',
  'outage',
  'downtime',
  'disruption',
  'service disruption',
  'power grid',
  'network outage',
];

export const LOW_QUALITY_POLICY = (process.env.LOW_QUALITY_POLICY ?? 'drop')
  .trim()
  .toLowerCase();
export const LOW_QUALITY_DOWNGRADE_MAX_IMPORTANCE = Number(
  process.env.LOW_QUALITY_DOWNGRADE_MAX_IMPORTANCE ?? 1,
);
export const LOW_QUALITY_DOWNGRADE_RATIONALE = (
  process.env.LOW_QUALITY_DOWNGRADE_RATIONALE ?? '근거 부족이라 영향 판단 불가'
).trim();

export const STALE_EVENT_MAX_DAYS = Number(
  process.env.STALE_EVENT_MAX_DAYS ?? 90,
);
export const STALE_INCIDENT_TOPICAL_KEYWORDS = [
  '침해',
  '해킹',
  '유출',
  '사고',
  '사건',
  '누출',
  '탈취',
  'breach',
  'incident',
  'hack',
  'leak',
  'attack',
];
export const INCIDENT_CONTEXT_KEYWORDS = [
  '발생',
  '발생한',
  '침해',
  '해킹',
  '유출',
  '사고',
  '사건',
  '누출',
  '탈취',
  'breach',
  'incident',
  'hack',
  'happened',
  'occurred',
];
export const NON_EVENT_DATE_CONTEXT_KEYWORDS = [
  '분기',
  '실적',
  '매출',
  '영업이익',
  '순이익',
  '컨센서스',
  '가이던스',
  '전망',
  'forecast',
  'earnings',
  'quarter',
  'fiscal',
];
