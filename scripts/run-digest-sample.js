const fs = require('node:fs');
const path = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { DigestGeneratorService } = require('../dist/digest/services/digest-generator.service');
const { DigestStorageService } = require('../dist/digest/services/digest-storage.service');

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

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const generator = app.get(DigestGeneratorService);
    const storage = app.get(DigestStorageService);

    const started = Date.now();
    console.log(
      `[run-digest-sample] start: topLimit=${Number(process.env.TOP_LIMIT || 20)}`,
    );
    heartbeat = setInterval(() => {
      const sec = Math.floor((Date.now() - started) / 1000);
      console.log(`[run-digest-sample] progress: ${sec}s elapsed`);
    }, 10000);
    const digest = await generator.generateDigest({
      forceRegenerate: true,
      topLimit: Number(process.env.TOP_LIMIT || 20),
    });
    clearInterval(heartbeat);
    const metrics = await storage.loadMetrics();

    const durationMs = Date.now() - started;

    const summary = {
      generatedAt: new Date().toISOString(),
      durationMs,
      date: digest.date,
      items: digest.items.length,
      top3: digest.items.slice(0, 3).map((x) => ({
        id: x.id,
        title: x.title,
        importance: x.importance,
        qualityLabel: x.qualityLabel,
        sourceName: x.sourceName,
        impactLabels: (x.impactSignals || []).map((s) => s.label),
      })),
      metrics: metrics || null,
      env: {
        aiProvider: process.env.AI_PROVIDER || 'gemini(default)',
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
        hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
      },
    };

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    await app.close();
  }
}

main().catch((err) => {
  console.error('RUN_DIGEST_SAMPLE_FAILED');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
