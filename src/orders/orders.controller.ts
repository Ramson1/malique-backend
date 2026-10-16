import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAnyAuthGuard } from '../common/guards/jwt-any-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('orders')
@UseGuards(JwtAnyAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: any,
  ) {
    // For customers, use their ID; for staff creating on behalf, use the provided customerId
    const customerId = user.role === 'customer' ? user.id : (dto as any).customerId || user.id;
    return this.ordersService.create(dto, customerId);
  }

  @Get()
  findAll(
    @Query() pagination: PaginationDto,
    @CurrentUser() user: any,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    // Customers can only see their own orders
    const customerId = user.role === 'customer' ? user.id : undefined;
    // Staff without super_admin role see only their branch
    const effectiveBranchId =
      user.role === 'staff' || user.role === 'branch_manager'
        ? branchId || user.branchId
        : branchId;

    return this.ordersService.findAll(pagination, customerId, effectiveBranchId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    // Customers may only read their own order (404 otherwise, so the
    // tracking page can never leak another customer's data).
    return this.ordersService.findOne(id, user);
  }

  @Patch(':id/status')
  @UseGuards(RolesGuard)
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto);
  }
}
