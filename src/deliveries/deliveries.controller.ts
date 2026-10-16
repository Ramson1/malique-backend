import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { AssignRiderDto } from './dto/assign-rider.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('deliveries')
@UseGuards(JwtAuthGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Get()
  findAll(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: any,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    // Riders see only their own deliveries
    const riderId = user.role === 'rider' ? user.id : undefined;
    const effectiveBranchId =
      user.role === 'branch_manager' ? user.branchId : branchId;

    return this.deliveriesService.findAll(pagination, effectiveBranchId, riderId, status);
  }

  @Patch(':id/assign')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  assignRider(
    @Param('id') id: string,
    @Body() dto: AssignRiderDto,
  ) {
    return this.deliveriesService.assignRider(id, dto);
  }

  // Rider home-screen counters. Declared before ':id' so the literal paths
  // are never swallowed by the id route.
  @Get('stats/today')
  todayStats(@CurrentUser() user: any) {
    return this.deliveriesService.todayStats(user.id);
  }

  @Get('earnings')
  earnings(@CurrentUser() user: any) {
    return this.deliveriesService.earnings(user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.deliveriesService.findOne(id);
  }

  @Patch(':id/status')
  @Roles('rider', 'super_admin', 'admin', 'branch_manager')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.deliveriesService.updateStatus(id, dto, user.id);
  }
}
