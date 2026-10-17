import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PushModule } from '../push/push.module';
import { PosModule } from '../pos/pos.module';

// PrismaModule is @Global, so AdminService can inject PrismaService directly.
@Module({
  imports: [PushModule, PosModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
