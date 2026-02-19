import { Module } from '@nestjs/common';
import { DigestController } from './digest.controller';
import { DigestGeneratorService } from './services/digest-generator.service';
import { DigestStorageService } from './services/digest-storage.service';
import { DigestScoringService } from './services/digest-scoring.service';
import { DigestDedupeService } from './services/digest-dedupe.service';
import { RssFeedService } from './services/rss-feed.service';
import { LlmClientService } from './services/llm-client.service';
import { AiEnricherService } from './services/ai-enricher.service';
import { DigestAiService } from './services/digest-ai.service';
import { DigestValidationService } from './services/digest-validation.service';

@Module({
  controllers: [DigestController],
  providers: [
    DigestGeneratorService,
    DigestStorageService,
    DigestScoringService,
    DigestDedupeService,
    RssFeedService,
    LlmClientService,
    AiEnricherService,
    DigestAiService,
    DigestValidationService,
  ],
  exports: [DigestGeneratorService, DigestStorageService],
})
export class DigestModule {}
