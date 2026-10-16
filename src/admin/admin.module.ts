import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PushModule } from '../push/push.module';

// PrismaModule is @Global, so AdminService can inject PrismaService directly.
@Module({
  imports: [PushModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
