import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProductChangesService } from './product-changes.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateProductChangeDto,
  RejectProductChangeDto,
} from './dto/product-change.dto';

// Product change approval workflow. Portal (secretary) users submit
// proposals; super_admin/admin review and approve/reject them. Approval is
// the only moment live Product/ProductPrice rows are written, so nothing
// spreads to the website, POS or admin views until reviewed.
@Controller('product-changes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class ProductChangesController {
  constructor(private readonly service: ProductChangesService) {}

  // Portal + admin: list requests (own only for staff/branch_manager).
  @Get()
  list(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.service.list(user, status);
  }

  // Bell badge count. Scoped in the service: admins get the queue size,
  // everyone else only their own pending submissions.
  @Get('pending-count')
  pendingCount(@CurrentUser() user: any) {
    return this.service.pendingCount(user);
  }

  @Post()
  submit(@CurrentUser() user: any, @Body() dto: CreateProductChangeDto) {
    return this.service.submit(user, dto);
  }

  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.withdraw(user, id);
  }

  // ─── Review side (super_admin/admin only) ───────────────
  @Get('pending')
  @Roles('super_admin', 'admin')
  pending() {
    return this.service.list({ role: 'admin' }, 'pending');
  }

  @Post(':id/approve')
  @Roles('super_admin', 'admin')
  approve(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.approve(user, id);
  }

  @Post(':id/reject')
  @Roles('super_admin', 'admin')
  reject(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RejectProductChangeDto,
  ) {
    return this.service.reject(user, id, dto.reason);
  }
}
