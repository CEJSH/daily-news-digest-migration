const WS_RE = /\s+/g;
const TAG_RE = /<[^>]+>/g;

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export function decodeHtmlEntities(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (match) => ENTITY_MAP[match] ?? match,
  );
}

export function stripCdata(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1');
}

export function cleanText(value: string): string {
  if (!value) {
    return '';
  }
  const decoded = decodeHtmlEntities(stripCdata(value));
  return decoded.replace(TAG_RE, ' ').replace(WS_RE, ' ').trim();
}

export function trimTitleNoise(title: string, sourceName?: string): string {
  if (!title) {
    return '';
  }
  const normalizedTitle = cleanText(title);
  const breakingPrefixRe =
    /^\s*(?:\[|\()?((?:속보|breaking|just in))(?:\]|\))?[\s:：-]*/i;
  const hasBreakingPrefix = breakingPrefixRe.test(normalizedTitle);

  let out = normalizedTitle
    .replace(breakingPrefixRe, '')
    .replace(
      /^\s*(?:\[|\()?((?:단독|종합|상보|단신|해설|인터뷰|기획|특집|분석))(?:\]|\))?[\s:：-]*/i,
      '',
    )
    .trim();

  out = out.replace(/\s*[|\-–—·•:｜ㅣ]\s*[^|\-–—·•:｜ㅣ]+$/, '').trim();

  if (sourceName) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(
        new RegExp(`(?:\\s*[|\\-–—·•:｜ㅣ]\\s*)?${escaped}\\s*$`, 'i'),
        '',
      )
      .trim();
  }

  if (hasBreakingPrefix && out) {
    out = `속보 ${out}`;
  }

  return out;
}

export function splitSummaryToLines(summary: string): string[] {
  const cleaned = cleanText(summary);
  if (!cleaned) {
    return [];
  }

  const raw = cleaned
    .split(/(?<=[.!?。])\s+|\s*·\s*|\s*\|\s*|\n+/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const unique: string[] = [];
  for (const line of raw) {
    if (!unique.includes(line)) {
      unique.push(line);
    }
    if (unique.length >= 3) {
      break;
    }
  }

  if (unique.length === 0) {
    return [cleaned.slice(0, 160)];
  }
  return unique;
}

export function tokenizeForDedupe(value: string): string[] {
  const cleaned = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .replace(WS_RE, ' ')
    .trim();

  return cleaned ? cleaned.split(' ') : [];
}

export function normalizeSourceName(sourceName: string): string {
  if (!sourceName) {
    return '';
  }
  const normalized = sourceName
    .replace(/[^0-9a-zA-Z가-힣\s]/g, ' ')
    .replace(WS_RE, ' ')
    .trim();
  if (!normalized) {
    return '';
  }

  const token = normalized.split(' ')[0] ?? normalized;
  return (
    token.replace(/(일보|신문|뉴스|방송|미디어|TV|tv)$/u, '').trim() ||
    normalized
  );
}

export function estimateReadTimeSeconds(text: string): number {
  const cleaned = cleanText(text);
  if (!cleaned) {
    return 10;
  }
  const words = cleaned.split(' ').filter(Boolean).length;
  const sec = Math.ceil((words / 220) * 60);
  return Math.max(10, Math.min(120, sec));
}
