import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ReportQueryDto } from './dto/report.dto';

// Report exports (sales / gas-balance / attendance / payroll) in
// pdf | xlsx | docx | csv. Mounted under the admin path but as its own
// controller so it never collides with the existing /admin BFF routes and
// never affects web/rider. Streams files directly via the raw response.
@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // Branded per-order invoice / receipt PDF and per-delivery manifest PDF.
  // Declared before ':kind' so the ids are never treated as report kinds.
  @Get('invoice/:id')
  invoice(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: any) {
    return this.reportsService.invoicePdf(id, res, user);
  }

  @Get('manifest/:id')
  manifest(@Param('id') id: string, @Res() res: Response, @CurrentUser() user: any) {
    return this.reportsService.manifestPdf(id, res, user);
  }

  // JSON preview (same dataset the file exports are built from) so the Reports
  // page can show live results before a file is downloaded.
  @Get(':kind/data')
  data(@Param('kind') kind: string, @Query() query: ReportQueryDto, @CurrentUser() user: any) {
    return this.reportsService.preview(kind, query, user);
  }

  @Get(':kind')
  export(
    @Param('kind') kind: string,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
    @CurrentUser() user: any,
  ) {
    return this.reportsService.export(kind, query, res, user);
  }
}
