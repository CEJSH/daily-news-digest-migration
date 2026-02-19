import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DigestModule } from './digest/digest.module';

@Module({
  imports: [DigestModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
