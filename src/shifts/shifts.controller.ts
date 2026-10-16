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
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AssignShiftDto,
  CreateShiftDto,
  UpdateAssignmentStatusDto,
} from './dto/shifts.dto';

// Shift management. Root controller (web/rider never call /shifts).
@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  listShifts(@Query('branchId') branchId?: string) {
    return this.shiftsService.listShifts(branchId);
  }

  @Post()
  @Roles('super_admin', 'admin', 'branch_manager')
  createShift(@Body() dto: CreateShiftDto) {
    return this.shiftsService.createShift(dto);
  }

  @Patch(':id')
  @Roles('super_admin', 'admin', 'branch_manager')
  updateShift(@Param('id') id: string, @Body() dto: Partial<CreateShiftDto>) {
    return this.shiftsService.updateShift(id, dto as any);
  }

  @Delete(':id')
  @Roles('super_admin', 'admin', 'branch_manager')
  deleteShift(@Param('id') id: string) {
    return this.shiftsService.deleteShift(id);
  }

  @Get('staff')
  rosterStaff(@Query('branchId') branchId?: string) {
    return this.shiftsService.listRosterStaff(branchId);
  }

  @Get('roster')
  roster(
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.shiftsService.roster(branchId, from, to);
  }

  @Post('assign')
  @Roles('super_admin', 'admin', 'branch_manager')
  assign(@Body() dto: AssignShiftDto) {
    return this.shiftsService.assign(dto);
  }

  @Patch('assignment/:id')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  setStatus(@Param('id') id: string, @Body() dto: UpdateAssignmentStatusDto) {
    return this.shiftsService.setStatus(id, dto);
  }

  @Delete('assignment/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  remove(@Param('id') id: string) {
    return this.shiftsService.remove(id);
  }
}
