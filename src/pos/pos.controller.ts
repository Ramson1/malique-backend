import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PosService } from './pos.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateSaleDto,
  PosSalesQueryDto,
  VoidSaleDto,
} from './dto/pos.dto';

// Staff/secretary POS. Root controller (never under /admin). Branch scoping is
// enforced in the service from the JWT; privileged roles may pass branchId.
@Controller('pos')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get('catalog')
  catalog(@CurrentUser() user: any, @Query('branchId') branchId?: string) {
    return this.posService.catalog(user, branchId);
  }

  @Post('sales')
  createSale(@CurrentUser() user: any, @Body() dto: CreateSaleDto) {
    return this.posService.createSale(user, dto);
  }

  @Get('sales')
  listSales(@CurrentUser() user: any, @Query() query: PosSalesQueryDto) {
    return this.posService.listSales(user, query);
  }

  @Get('sales/:id')
  one(@CurrentUser() user: any, @Param('id') id: string) {
    return this.posService.findOne(user, id);
  }

  @Post('sales/:id/void')
  voidSale(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: VoidSaleDto) {
    return this.posService.voidSale(user, id, dto);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: any,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.posService.summary(user, { branchId, from, to, staffId });
  }

  @Get('inventory')
  inventory(@CurrentUser() user: any, @Query('branchId') branchId?: string) {
    return this.posService.inventory(user, branchId);
  }
}
