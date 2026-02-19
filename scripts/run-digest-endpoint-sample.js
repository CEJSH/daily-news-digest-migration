const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { Test } = require('@nestjs/testing');
const { AppModule } = require('../dist/app.module');

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  parseEnvFile(path.join(process.cwd(), '.env'));
  let heartbeat = null;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  try {
    const started = Date.now();
    console.log('[run-digest-endpoint-sample] start: GET /digest?force=1');
    heartbeat = setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      console.log(`[run-digest-endpoint-sample] progress: ${sec}s elapsed`);
    }, 10000);
    const digestRes = await request(app.getHttpServer()).get('/digest?force=1').expect(200);
    const metricsRes = await request(app.getHttpServer()).get('/digest/metrics').expect(200);

    const digest = digestRes.body;
    const metrics = metricsRes.body;

    const result = {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      endpoint: '/digest?force=1',
      date: digest.date,
      items: Array.isArray(digest.items) ? digest.items.length : 0,
      top3: (digest.items || []).slice(0, 3).map((item) => ({
        id: item.id,
        title: item.title,
        sourceName: item.sourceName,
        importance: item.importance,
        qualityLabel: item.qualityLabel,
        impactLabels: (item.impactSignals || []).map((x) => x.label),
      })),
      metrics,
      env: {
        aiProvider: process.env.AI_PROVIDER || 'gemini(default)',
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
        hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      },
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    await app.close();
  }
}

main().catch((err) => {
  console.error('RUN_DIGEST_ENDPOINT_SAMPLE_FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
