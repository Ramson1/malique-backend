import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  getOverview(@Query('branchId') branchId?: string) {
    return this.analyticsService.getOverview(branchId);
  }

  @Get('orders')
  getOrderTrends(
    @Query('branchId') branchId?: string,
    @Query('days') days: number = 30,
  ) {
    return this.analyticsService.getOrderTrends(branchId, days);
  }

  @Get('revenue')
  getRevenueTrends(
    @Query('branchId') branchId?: string,
    @Query('days') days: number = 30,
  ) {
    return this.analyticsService.getRevenueTrends(branchId, days);
  }
}
