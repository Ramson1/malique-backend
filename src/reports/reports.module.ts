import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { GasModule } from '../gas/gas.module';
import { PayrollModule } from '../payroll/payroll.module';

// PrismaModule is @Global; GasService + PayrollService are re-used here so the
// gas-balance and payroll reports share exactly the same engine as their pages.
@Module({
  imports: [GasModule, PayrollModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
