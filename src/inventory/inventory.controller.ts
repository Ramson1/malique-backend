import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  findByBranch(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId =
      user.role === 'branch_manager' ? user.branchId : branchId;

    if (!effectiveBranchId) {
      return { data: [], total: 0, page: pagination.page, limit: pagination.limit };
    }

    return this.inventoryService.findByBranch(effectiveBranchId, pagination);
  }

  @Post('adjust')
  @Roles('super_admin', 'admin', 'branch_manager')
  adjustStock(
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: any,
  ) {
    return this.inventoryService.adjustStock(
      dto.branchId,
      dto.productId,
      dto.sizeKg,
      dto.quantityChange,
      user.id,
    );
  }

  @Get('low')
  getLowStock(
    @CurrentUser() user: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId =
      user.role === 'branch_manager' ? user.branchId : branchId;

    return this.inventoryService.getLowStock(effectiveBranchId);
  }
}
