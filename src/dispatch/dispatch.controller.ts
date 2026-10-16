import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ScheduleDeliveryDto, ReassignRiderDto, UpdateBoardStatusDto } from './dto/dispatch.dto';

// Rider dispatch & order scheduling board. Mounted under the admin path as its
// own controller so it never collides with the existing /admin BFF routes and
// leaves the rider app's /deliveries polling untouched.
@Controller('admin/dispatch')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  @Get()
  board(@Query('branchId') branchId?: string) {
    return this.dispatchService.board(branchId);
  }

  @Patch(':id/schedule')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  schedule(@Param('id') id: string, @Body() dto: ScheduleDeliveryDto) {
    return this.dispatchService.schedule(id, dto);
  }

  @Post(':id/dispatch')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  dispatch(@Param('id') id: string) {
    return this.dispatchService.markDispatched(id);
  }

  @Patch(':id/rider')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  reassign(@Param('id') id: string, @Body() dto: ReassignRiderDto) {
    return this.dispatchService.reassign(id, dto.riderId);
  }

  @Patch(':id/status')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  setBoardStatus(@Param('id') id: string, @Body() dto: UpdateBoardStatusDto) {
    return this.dispatchService.setBoardStatus(id, dto.status);
  }
}
