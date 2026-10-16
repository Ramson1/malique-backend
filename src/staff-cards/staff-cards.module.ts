import { Module } from '@nestjs/common';
import { StaffCardsController } from './staff-cards.controller';
import { StaffCardsService } from './staff-cards.service';

// PrismaModule is @Global, so PrismaService injects without an explicit import.
@Module({
  controllers: [StaffCardsController],
  providers: [StaffCardsService],
  exports: [StaffCardsService],
})
export class StaffCardsModule {}
