import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';

// Global-style shared service: other modules (deliveries, dispatch, admin,
// orders) import this to fire rider alerts on assignment.
@Module({
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
