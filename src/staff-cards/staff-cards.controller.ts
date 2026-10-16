import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { StaffCardsService } from './staff-cards.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

// Printable/exportable staff ID cards (PDF, front + back). Kept under the
// /admin/staff prefix but in its own controller so it never collides with the
// BFF's admin/staff CRUD routes (different full paths).
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager')
export class StaffCardsController {
  constructor(private readonly service: StaffCardsService) {}

  // Batch export — declared before the :id route so "id-cards.pdf" is matched.
  @Get('id-cards.pdf')
  batch(@Res() res: Response, @Query('branchId') branchId?: string) {
    return this.service.batchPdf(res, branchId);
  }

  @Get(':id/id-card.pdf')
  one(@Param('id') id: string, @Res() res: Response) {
    return this.service.idCardPdf(id, res);
  }
}
