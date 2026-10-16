import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GasService } from './gas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateGasPurchaseDto,
  CreateTankReadingDto,
  CreateCylinderFillDto,
  GasBalanceQueryDto,
} from './dto/gas.dto';

// LPG mass-balance. Root controller (web/rider never call /gas).
// Reads are open to portal staff; writes are manager-and-above and are
// captured by the global AuditInterceptor (never for super_admin).
@Controller('gas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class GasController {
  constructor(private readonly gasService: GasService) {}

  @Get('balance')
  balance(@Query() query: GasBalanceQueryDto) {
    return this.gasService.balance(query);
  }

  @Get('cylinders')
  listCylinders(@Query('branchId') branchId?: string) {
    return this.gasService.listCylinders(branchId);
  }

  @Get('tanks')
  listTanks(@Query('branchId') branchId?: string) {
    return this.gasService.listTanks(branchId);
  }

  @Get('purchases')
  listPurchases(@Query('branchId') branchId?: string) {
    return this.gasService.listPurchases(branchId);
  }

  @Post('purchase')
  @Roles('super_admin', 'admin', 'branch_manager')
  createPurchase(@Body() dto: CreateGasPurchaseDto, @CurrentUser() user: any) {
    return this.gasService.createPurchase(dto, user);
  }

  @Get('readings')
  listReadings(@Query('branchId') branchId?: string) {
    return this.gasService.listReadings(branchId);
  }

  @Post('reading')
  @Roles('super_admin', 'admin', 'branch_manager')
  createReading(@Body() dto: CreateTankReadingDto, @CurrentUser() user: any) {
    return this.gasService.createReading(dto, user);
  }

  @Get('fills')
  listFills(@Query('branchId') branchId?: string) {
    return this.gasService.listFills(branchId);
  }

  @Post('fill')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  createFill(@Body() dto: CreateCylinderFillDto, @CurrentUser() user: any) {
    return this.gasService.createFill(dto, user);
  }

  @Get('reconciliations')
  listReconciliations(@Query('branchId') branchId?: string) {
    return this.gasService.listReconciliations(branchId);
  }

  @Post('reconcile')
  @Roles('super_admin', 'admin', 'branch_manager')
  reconcile(@Body() query: GasBalanceQueryDto, @CurrentUser() user: any) {
    return this.gasService.reconcile(query, user);
  }
}
