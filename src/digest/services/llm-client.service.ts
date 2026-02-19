import { Injectable, Logger } from '@nestjs/common';
import { AI_EMBED_MAX_CHARS, AI_PROVIDER } from '../config/digest.constants';
import { cleanText } from '../utils/text.util';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

@Injectable()
export class LlmClientService {
  private readonly logger = new Logger(LlmClientService.name);
  private readonly unavailableLogged = new Set<string>();

  async generateJson(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Record<string, unknown> | null> {
    if (AI_PROVIDER === 'openai') {
      return this.openaiGenerateJson(systemPrompt, userPrompt);
    }
    return this.geminiGenerateJson(systemPrompt, userPrompt);
  }

  async getEmbedding(text: string): Promise<number[] | null> {
    const cleaned = cleanText(text || '');
    if (!cleaned) {
      return null;
    }

    const input = cleaned.slice(0, AI_EMBED_MAX_CHARS);
    if (AI_PROVIDER === 'openai') {
      return this.openaiEmbedding(input);
    }
    return this.geminiEmbedding(input);
  }

  private async geminiGenerateJson(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Record<string, unknown> | null> {
    const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
    if (!apiKey) {
      this.logUnavailable('GEMINI_API_KEY 미설정');
      return null;
    }

    const base =
      process.env.GEMINI_API_BASE ??
      'https://generativelanguage.googleapis.com/v1beta';
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
    const maxOutputTokens = Number(
      process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 1000,
    );
    const retries = Number(process.env.GEMINI_MAX_RETRIES ?? 2);
    const backoffSec = Number(process.env.GEMINI_RETRY_BACKOFF_SEC ?? 1.5);
    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_SEC ?? 60) * 1000;

    const url = `${base}/models/${model}:generateContent`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    };

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const response = await this.safeFetchJson(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs,
      });

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt <= retries) {
          await this.sleep(backoffSec * 1000 * 2 ** (attempt - 1));
          continue;
        }
        this.logUnavailable(
          'gemini_generate_failed',
          `${response.status} ${response.raw.slice(0, 180)}`,
        );
        return null;
      }

      const text = this.extractGeminiText(response.json);
      const parsed = this.parseJsonObject(text);
      if (parsed) {
        return parsed;
      }

      if (attempt <= retries) {
        await this.sleep(backoffSec * 1000 * 2 ** (attempt - 1));
        continue;
      }

      this.logUnavailable('Gemini 응답 JSON 파싱 실패');
      return null;
    }

    return null;
  }

  private async geminiEmbedding(text: string): Promise<number[] | null> {
    const apiKey = (process.env.GEMINI_API_KEY ?? '').trim();
    if (!apiKey) {
      this.logUnavailable('GEMINI_API_KEY 미설정');
      return null;
    }

    const base =
      process.env.GEMINI_API_BASE ??
      'https://generativelanguage.googleapis.com/v1beta';
    const model = process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001';
    const url = `${base}/models/${model}:embedContent`;

    const response = await this.safeFetchJson(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] },
      }),
      timeoutMs: 30000,
    });

    if (!response.ok) {
      this.logUnavailable('gemini_embedding_failed', `${response.status}`);
      return null;
    }

    const embeddingObj = this.asRecord(response.json?.embedding);
    const valuesUnknown = embeddingObj?.values ?? embeddingObj?.value;
    if (!Array.isArray(valuesUnknown)) {
      return null;
    }

    const values = valuesUnknown.filter(
      (v): v is number => typeof v === 'number',
    );
    return values.length ? values : null;
  }

  private async openaiGenerateJson(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<Record<string, unknown> | null> {
    const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) {
      this.logUnavailable('OPENAI_API_KEY 미설정');
      return null;
    }

    const base = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const retries = Number(process.env.OPENAI_MAX_RETRIES ?? 2);
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_SEC ?? 60) * 1000;

    const payload = {
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    };

    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
      const response = await this.safeFetchJson(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs,
      });

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt <= retries) {
          await this.sleep(1200 * 2 ** (attempt - 1));
          continue;
        }
        this.logUnavailable(
          'openai_generate_failed',
          `${response.status} ${response.raw.slice(0, 180)}`,
        );
        return null;
      }

      const choices = Array.isArray(response.json?.choices)
        ? (response.json?.choices as unknown[])
        : [];
      const first = this.asRecord(choices[0]);
      const message = this.asRecord(first?.message);
      const content =
        typeof message?.content === 'string' ? message.content : '';
      const parsed = this.parseJsonObject(content);
      if (parsed) {
        return parsed;
      }
    }

    this.logUnavailable('OpenAI 응답 JSON 파싱 실패');
    return null;
  }

  private async openaiEmbedding(text: string): Promise<number[] | null> {
    const apiKey = (process.env.OPENAI_API_KEY ?? '').trim();
    if (!apiKey) {
      this.logUnavailable('OPENAI_API_KEY 미설정');
      return null;
    }

    const base = process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1';
    const model =
      process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

    const response = await this.safeFetchJson(`${base}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: text }),
      timeoutMs: 30000,
    });

    if (!response.ok) {
      this.logUnavailable('openai_embedding_failed', `${response.status}`);
      return null;
    }

    const data = Array.isArray(response.json?.data)
      ? (response.json?.data as unknown[])
      : [];
    const first = this.asRecord(data[0]);
    const emb = first?.embedding;
    if (!Array.isArray(emb)) {
      return null;
    }
    const values = emb.filter((v): v is number => typeof v === 'number');
    return values.length ? values : null;
  }

  private parseJsonObject(text: string): Record<string, unknown> | null {
    if (!text) {
      return null;
    }
    const trimmed = text
      .trim()
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const direct = this.tryJsonParse(trimmed);
    if (direct) {
      return direct;
    }

    const block = this.extractJsonBlock(trimmed);
    if (!block) {
      return null;
    }

    return (
      this.tryJsonParse(block) ??
      this.tryJsonParse(this.stripTrailingCommas(block))
    );
  }

  private extractGeminiText(json: unknown): string {
    const root = this.asRecord(json);
    const candidates = Array.isArray(root?.candidates) ? root.candidates : [];
    const firstCandidate = this.asRecord(candidates[0]);
    const content = this.asRecord(firstCandidate?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const firstPart = this.asRecord(parts[0]);
    return typeof firstPart?.text === 'string' ? firstPart.text : '';
  }

  private tryJsonParse(value: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(value);
      return this.asRecord(parsed);
    } catch {
      return null;
    }
  }

  private extractJsonBlock(value: string): string | null {
    const start = value.indexOf('{');
    if (start === -1) {
      return null;
    }

    let depth = 0;
    for (let i = start; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          return value.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  private stripTrailingCommas(value: string): string {
    return value.replace(/,\s*([}\]])/g, '$1');
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private async safeFetchJson(
    url: string,
    params: {
      method: 'POST' | 'GET';
      headers: Record<string, string>;
      body?: string;
      timeoutMs: number;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    raw: string;
    json: Record<string, unknown> | null;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

    try {
      const res = await fetch(url, {
        method: params.method,
        headers: params.headers,
        body: params.body,
        signal: controller.signal,
      });
      const raw = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = this.asRecord(JSON.parse(raw));
      } catch {
        json = null;
      }
      return {
        ok: res.ok,
        status: res.status,
        raw,
        json,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: 0,
        raw: message,
        json: null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private logUnavailable(reason: string, detail?: string): void {
    if (this.unavailableLogged.has(reason)) {
      return;
    }
    this.unavailableLogged.add(reason);
    const detailText = cleanText(detail || '');
    if (detailText) {
      this.logger.warn(`AI unavailable: ${reason} (${detailText})`);
      return;
    }
    this.logger.warn(`AI unavailable: ${reason}`);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
