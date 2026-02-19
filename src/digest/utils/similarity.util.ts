export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function ngramSet(value: string, n = 2): Set<string> {
  const compact = value.toLowerCase().replace(/[-\s]+/g, '');
  if (compact.length < n) {
    return new Set();
  }

  const out = new Set<string>();
  for (let i = 0; i <= compact.length - n; i += 1) {
    out.add(compact.slice(i, i + n));
  }
  return out;
}
