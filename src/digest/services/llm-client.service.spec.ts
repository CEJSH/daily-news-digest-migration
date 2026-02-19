import { Logger } from '@nestjs/common';
import { LlmClientService } from './llm-client.service';

describe('LlmClientService', () => {
  it('deduplicates unavailable logs by reason key', async () => {
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevProvider = process.env.AI_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    process.env.AI_PROVIDER = 'gemini';

    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const service = new LlmClientService();

    try {
      await service.generateJson('system', 'user');
      await service.generateJson('system', 'user');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      if (prevGeminiKey == null) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = prevGeminiKey;
      }
      if (prevProvider == null) {
        delete process.env.AI_PROVIDER;
      } else {
        process.env.AI_PROVIDER = prevProvider;
      }
      warnSpy.mockRestore();
    }
  });
});
