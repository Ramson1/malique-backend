import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ClockInDto } from './dto/clock-in.dto';
import { VerifyClockDto, VerifyClockOutDto } from './dto/verify-clock.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('clock-in')
  clockIn(
    @CurrentUser() user: any,
    @Body() dto: ClockInDto,
  ) {
    return this.attendanceService.clockIn(user.id, dto);
  }

  @Post('clock-out')
  clockOut(
    @CurrentUser() user: any,
    @Body() body: { notes?: string },
  ) {
    return this.attendanceService.clockOut(user.id, body?.notes);
  }

  // Anti-fraud terminal check-in: possession (badge QR / staff code) + PIN.
  @Post('verify-clock')
  verifyClock(@Body() dto: VerifyClockDto) {
    return this.attendanceService.verifyClock(dto);
  }

  @Post('verify-clock-out')
  verifyClockOut(@Body() dto: VerifyClockOutDto) {
    return this.attendanceService.verifyClockOut(dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  findAll(
    @Query() pagination: PaginationDto,
    @Query('userId') userId?: string,
    @Query('branchId') branchId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.attendanceService.findAll(pagination, userId, branchId, startDate, endDate);
  }
}
