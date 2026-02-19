import { Injectable, Logger } from '@nestjs/common';
import { RssEntry } from '../types/digest.types';
import { cleanText, trimTitleNoise } from '../utils/text.util';
import { parseDateToIso } from '../utils/date.util';

@Injectable()
export class RssFeedService {
  private readonly logger = new Logger(RssFeedService.name);

  async fetch(
    url: string,
    limit: number,
    options?: { freshnessWindow?: string },
  ): Promise<RssEntry[]> {
    const startedAt = Date.now();
    this.logger.log(`rss fetch start: limit=${limit} ${this.describeUrl(url)}`);
    const requestUrl = this.withGoogleFreshnessHint(
      url,
      options?.freshnessWindow,
    );
    const preferred = await this.fetchOnce(requestUrl, limit);

    if (requestUrl === url) {
      this.logger.log(
        `rss fetch done: items=${preferred.length} elapsedMs=${Date.now() - startedAt} ${this.describeUrl(requestUrl)}`,
      );
      return preferred;
    }

    if (preferred.length > 0) {
      this.logger.log(
        `rss fetch done(with freshness hint): items=${preferred.length} elapsedMs=${Date.now() - startedAt} ${this.describeUrl(requestUrl)}`,
      );
      return preferred;
    }

    const fallback = await this.fetchOnce(url, limit);
    if (fallback.length > preferred.length) {
      this.logger.log(
        `rss freshness fallback enabled: ${preferred.length} -> ${fallback.length} (${url})`,
      );
      this.logger.log(
        `rss fetch done(fallback): items=${fallback.length} elapsedMs=${Date.now() - startedAt} ${this.describeUrl(url)}`,
      );
      return fallback;
    }
    this.logger.log(
      `rss fetch done: items=${preferred.length} elapsedMs=${Date.now() - startedAt} ${this.describeUrl(url)}`,
    );
    return preferred;
  }

  private async fetchOnce(url: string, limit: number): Promise<RssEntry[]> {
    const timeoutMs = Number(process.env.RSS_FETCH_TIMEOUT_SEC ?? 12) * 1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'daily-news-digest-nest/1.0',
          Accept:
            'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(`rss fetch failed: ${res.status} ${url}`);
        return [];
      }

      const xml = await res.text();
      return this.parseRss(xml).slice(0, limit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`rss fetch error: ${url} ${message}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  private withGoogleFreshnessHint(
    url: string,
    overrideWindow?: string,
  ): string {
    const rawWindow = (
      overrideWindow ??
      process.env.GOOGLE_RSS_WHEN ??
      ''
    ).trim();
    if (!rawWindow || rawWindow.toLowerCase() === 'off') {
      return url;
    }
    const normalizedWindow = rawWindow.startsWith('when:')
      ? rawWindow
      : `when:${rawWindow}`;

    try {
      const parsed = new URL(url);
      if (
        parsed.hostname !== 'news.google.com' ||
        !parsed.pathname.includes('/rss/search')
      ) {
        return url;
      }
      const q = parsed.searchParams.get('q');
      if (!q || /\bwhen:\d+[hdwmy]\b/i.test(q)) {
        return url;
      }
      parsed.searchParams.set('q', `${q} ${normalizedWindow}`);
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private parseRss(xml: string): RssEntry[] {
    const items: string[] = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
    return items
      .map((itemXml: string) => {
        const rawTitle = this.extractTag(itemXml, 'title');
        const sourceName = this.extractTag(itemXml, 'source');
        const title = trimTitleNoise(rawTitle, sourceName);
        const summary = cleanText(this.extractTag(itemXml, 'description'));
        const link = cleanText(this.extractTag(itemXml, 'link'));

        return {
          title,
          link,
          summary,
          sourceName,
          publishedAt: this.extractPublishedAt(itemXml),
        };
      })
      .filter((entry) => entry.title && entry.link);
  }

  private extractPublishedAt(itemXml: string): string {
    const tags = ['pubDate', 'published', 'updated', 'dc:date'];
    for (const tag of tags) {
      const raw = cleanText(this.extractTag(itemXml, tag));
      const iso = parseDateToIso(raw);
      if (iso) {
        return iso;
      }
    }
    return '';
  }

  private extractTag(xml: string, tagName: string): string {
    const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`,
      'i',
    );
    const match = xml.match(regex);
    if (!match?.[1]) {
      return '';
    }
    return cleanText(match[1]);
  }

  private describeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const q = (parsed.searchParams.get('q') || '').slice(0, 36);
      return `host=${parsed.hostname} q=${q}`;
    } catch {
      return `url=${url.slice(0, 80)}`;
    }
  }
}
