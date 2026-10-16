import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  AddPayrollEntryDto,
  GeneratePayrollDto,
  ListPayrollQueryDto,
  SetPayrollStatusDto,
} from './dto/payroll.dto';

// Payroll & salary management. Root controller (web/rider never call /payroll).
// Reads are open to portal staff; generation, entry edits and approvals are
// manager-and-above. All writes are captured by the global AuditInterceptor
// (never for super_admin).
@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get()
  list(@Query() query: ListPayrollQueryDto) {
    return this.payrollService.listPayroll(query);
  }

  @Get('payslip/:userId')
  payslip(@Param('userId') userId: string, @Query('period') period: string) {
    return this.payrollService.payslip(userId, period);
  }

  @Post('generate')
  @Roles('super_admin', 'admin', 'branch_manager')
  generate(@Body() dto: GeneratePayrollDto, @CurrentUser() user: any) {
    return this.payrollService.generate(dto, user);
  }

  @Post('entry')
  @Roles('super_admin', 'admin', 'branch_manager')
  addEntry(@Body() dto: AddPayrollEntryDto, @CurrentUser() user: any) {
    return this.payrollService.addEntry(dto, user);
  }

  @Delete('entry/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  removeEntry(@Param('id') id: string) {
    return this.payrollService.removeEntry(id);
  }

  @Patch(':id/status')
  @Roles('super_admin', 'admin', 'branch_manager')
  setStatus(
    @Param('id') id: string,
    @Body() dto: SetPayrollStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.payrollService.setStatus(id, dto, user);
  }
}
