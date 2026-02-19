import { RssEntry } from '../types/digest.types';
import { RssFeedService } from './rss-feed.service';

describe('RssFeedService', () => {
  it('parses publishedAt from fallback tags when pubDate is missing', () => {
    const service = new RssFeedService();
    const parser = service as unknown as {
      parseRss: (xml: string) => RssEntry[];
    };
    const xml = `
      <rss><channel>
        <item>
          <title>Fallback Date Item</title>
          <description>desc</description>
          <link>https://example.com/news/1</link>
          <published>2026-02-16T03:00:00Z</published>
        </item>
      </channel></rss>
    `;

    const entries = parser.parseRss(xml);

    expect(entries).toHaveLength(1);
    expect(entries[0].publishedAt).toBe('2026-02-16T03:00:00.000Z');
  });

  it('parses dc:date when available', () => {
    const service = new RssFeedService();
    const parser = service as unknown as {
      parseRss: (xml: string) => RssEntry[];
    };
    const xml = `
      <rss><channel>
        <item>
          <title>DC Date Item</title>
          <description>desc</description>
          <link>https://example.com/news/2</link>
          <dc:date>2026-02-16T05:30:00Z</dc:date>
        </item>
      </channel></rss>
    `;

    const entries = parser.parseRss(xml);

    expect(entries).toHaveLength(1);
    expect(entries[0].publishedAt).toBe('2026-02-16T05:30:00.000Z');
  });
});
