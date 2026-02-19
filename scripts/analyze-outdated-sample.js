const fs = require('node:fs');
const path = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const {
  RSS_SOURCES,
} = require('../dist/digest/config/rss-sources');
const {
  TOP_FRESH_MAX_HOURS,
  TOP_FRESH_EXCEPT_MAX_HOURS,
  TOP_FRESH_EXCEPT_SIGNALS,
} = require('../dist/digest/config/digest.constants');
const {
  computeAgeHours,
} = require('../dist/digest/utils/date.util');
const {
  cleanText,
} = require('../dist/digest/utils/text.util');
const {
  RssFeedService,
} = require('../dist/digest/services/rss-feed.service');
const {
  DigestScoringService,
} = require('../dist/digest/services/digest-scoring.service');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const lineRaw of raw.split(/\n/)) {
    const line = lineRaw.replace(/\r$/, '');
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) {
      continue;
    }
    const key = m[1];
    let value = m[2] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function toFixedOrNull(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(digits));
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function summarizeBuckets(rows) {
  const bucketRules = [
    { name: '85-96h', min: 84, max: 96 },
    { name: '97-120h', min: 96, max: 120 },
    { name: '121-168h', min: 120, max: 168 },
    { name: '169-192h', min: 168, max: 192 },
    { name: '193h+', min: 192, max: Number.POSITIVE_INFINITY },
  ];
  const buckets = {};
  for (const row of rows) {
    const age = row.ageHours;
    if (age == null) {
      continue;
    }
    const rule = bucketRules.find((r) => age > r.min && age <= r.max);
    if (rule) {
      buckets[rule.name] = (buckets[rule.name] ?? 0) + 1;
    }
  }
  return buckets;
}

function simulateRecovered(rows, nextTopMax, nextExceptMax) {
  let recovered = 0;
  for (const row of rows) {
    if (row.ageHours == null) {
      continue;
    }
    if (row.hasExceptSignal) {
      if (row.ageHours <= nextExceptMax) {
        recovered += 1;
      }
      continue;
    }
    if (row.ageHours <= nextTopMax) {
      recovered += 1;
    }
  }
  return recovered;
}

async function main() {
  parseEnvFile(path.join(process.cwd(), '.env'));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const rssFeedService = app.get(RssFeedService);
    const scoringService = app.get(DigestScoringService);

    const sourceFeeds = await Promise.all(
      RSS_SOURCES.map(async (source) => ({
        source,
        entries: await rssFeedService.fetch(source.url, source.limit, {
          freshnessWindow: source.freshnessWindow,
        }),
      })),
    );

    const allRows = [];
    for (const { source, entries } of sourceFeeds) {
      for (const entry of entries) {
        const title = cleanText(entry.title);
        const summary = cleanText(entry.summary);
        const ageHours = computeAgeHours(entry.publishedAt);
        const text = `${title} ${summary}`.trim();
        const impactSignals = scoringService.getImpactSignals(text);
        const hasExceptSignal = impactSignals.some((label) =>
          TOP_FRESH_EXCEPT_SIGNALS.has(label),
        );
        const skipReason = scoringService.getSkipReason({
          title,
          summary,
          link: entry.link || '',
          ageHours,
          impactSignals,
        });
        allRows.push({
          sourceTopic: source.topic,
          sourceName: cleanText(entry.sourceName || ''),
          title,
          link: entry.link || '',
          publishedAt: entry.publishedAt || null,
          ageHours,
          impactSignals,
          hasExceptSignal,
          skipReason,
        });
      }
    }

    const outdatedRows = allRows.filter((row) => row.skipReason === 'outdated');
    const noExceptRows = outdatedRows.filter((row) => !row.hasExceptSignal);
    const exceptRows = outdatedRows.filter((row) => row.hasExceptSignal);

    const noExceptNearest = [...noExceptRows]
      .sort(
        (a, b) =>
          (a.ageHours ?? Number.POSITIVE_INFINITY) -
          (b.ageHours ?? Number.POSITIVE_INFINITY),
      )
      .slice(0, 10);
    const exceptNearest = [...exceptRows]
      .sort(
        (a, b) =>
          (a.ageHours ?? Number.POSITIVE_INFINITY) -
          (b.ageHours ?? Number.POSITIVE_INFINITY),
      )
      .slice(0, 10);

    let samples = [...noExceptNearest, ...exceptNearest];
    if (samples.length < 20) {
      const selectedLinks = new Set(samples.map((item) => item.link));
      const additional = [...outdatedRows]
        .sort(
          (a, b) =>
            (a.ageHours ?? Number.POSITIVE_INFINITY) -
            (b.ageHours ?? Number.POSITIVE_INFINITY),
        )
        .filter((row) => !selectedLinks.has(row.link))
        .slice(0, 20 - samples.length);
      samples = [...samples, ...additional];
    }

    const compactSamples = samples.map((row, index) => ({
      rank: index + 1,
      title: row.title,
      sourceName: row.sourceName || 'unknown',
      sourceTopic: row.sourceTopic,
      publishedAt: row.publishedAt,
      ageHours: toFixedOrNull(row.ageHours, 1),
      impactSignals: row.impactSignals,
      hasExceptSignal: row.hasExceptSignal,
      link: row.link,
    }));

    const scenario96_168 = simulateRecovered(
      outdatedRows,
      96,
      TOP_FRESH_EXCEPT_MAX_HOURS,
    );
    const scenario96_192 = simulateRecovered(outdatedRows, 96, 192);
    const scenario108_192 = simulateRecovered(outdatedRows, 108, 192);

    const result = {
      generatedAt: new Date().toISOString(),
      thresholds: {
        topFreshMaxHours: TOP_FRESH_MAX_HOURS,
        topFreshExceptMaxHours: TOP_FRESH_EXCEPT_MAX_HOURS,
        topFreshExceptSignals: [...TOP_FRESH_EXCEPT_SIGNALS],
      },
      totals: {
        scanned: allRows.length,
        outdated: outdatedRows.length,
        outdatedNoExcept: noExceptRows.length,
        outdatedWithExcept: exceptRows.length,
      },
      outdatedAgeBuckets: summarizeBuckets(outdatedRows),
      outdatedTopSignals: countBy(outdatedRows, (row) =>
        row.impactSignals.join(',') || 'none',
      ),
      simulation: {
        recoverIfTop96ExceptCurrent: scenario96_168,
        recoverIfTop96Except192: scenario96_192,
        recoverIfTop108Except192: scenario108_192,
      },
      samples: compactSamples,
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('ANALYZE_OUTDATED_SAMPLE_FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
