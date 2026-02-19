import { RSS_SOURCES } from './rss-sources';

describe('RSS_SOURCES mix', () => {
  it('keeps a meaningful domestic policy/industry/economy slice', () => {
    const domestic = RSS_SOURCES.filter((source) =>
      source.topic.startsWith('국내_'),
    );
    const domesticLimit = domestic.reduce(
      (sum, source) => sum + source.limit,
      0,
    );

    expect(domestic.length).toBeGreaterThanOrEqual(4);
    expect(domesticLimit).toBeGreaterThanOrEqual(55);
  });

  it('caps direct IT/global headline feed share to avoid overconcentration', () => {
    const concentratedTopics = new Set(['IT', '글로벌_정세', '글로벌_빅테크']);
    const concentratedLimit = RSS_SOURCES.filter((source) =>
      concentratedTopics.has(source.topic),
    ).reduce((sum, source) => sum + source.limit, 0);
    const totalLimit = RSS_SOURCES.reduce(
      (sum, source) => sum + source.limit,
      0,
    );
    const share = totalLimit > 0 ? concentratedLimit / totalLimit : 1;

    expect(share).toBeLessThanOrEqual(0.3);
  });
});
