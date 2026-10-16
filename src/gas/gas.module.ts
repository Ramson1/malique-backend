import { Module } from '@nestjs/common';
import { GasController } from './gas.controller';
import { GasService } from './gas.service';

// PrismaModule + AuditModule are @Global, so GasService can inject PrismaService
// and the global AuditInterceptor documents gas writes automatically.
@Module({
  controllers: [GasController],
  providers: [GasService],
  exports: [GasService],
})
export class GasModule {}
