import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { PosService } from '../pos/pos.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

// Admin BFF: serves the /admin/* contract consumed by the admin portal,
// shaping Prisma data into the exact payloads each dashboard page expects.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin', 'admin', 'branch_manager', 'staff')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly posService: PosService,
  ) {}

  // Dashboard + analytics
  @Get('dashboard/stats')
  dashboardStats() {
    return this.adminService.dashboardStats();
  }

  // Unified command-centre (= merged stats + analytics) with global filters.
  @Get('dashboard')
  dashboard(
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.dashboard({ branchId, from, to });
  }

  @Get('analytics')
  analytics(
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.analytics({ branchId, from, to });
  }

  // Orders
  @Get('orders')
  listOrders(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('branchId') branchId?: string,
  ) {
    // Secretaries and other branch staff only ever see their own branch's
    // queue; admins can still scope explicitly or see everything.
    const privileged = ['super_admin', 'admin'].includes(user?.role);
    const scopedBranchId = branchId || (!privileged ? user?.branchId : undefined);
    return this.adminService.listOrders({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status,
      search,
      branchId: scopedBranchId,
    });
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return this.adminService.getOrder(id);
  }

  @Patch('orders/:id/status')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  updateOrderStatus(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateOrderStatus(id, body);
  }

  // Manual order entry — delegates to the same sale flow the staff POS uses
  // (walk-in or registered customer, pricing, stock deduction, notifications).
  @Post('orders')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  createOrder(@CurrentUser() user: any, @Body() body: any) {
    return this.posService.createSale(user, body);
  }

  // Staff
  @Get('staff')
  listStaff() {
    return this.adminService.listStaff();
  }

  @Post('staff')
  @Roles('super_admin', 'admin', 'branch_manager')
  createStaff(@Body() body: any) {
    return this.adminService.createStaff(body);
  }

  @Patch('staff/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  updateStaff(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateStaff(id, body);
  }

  // Anti-fraud check-in credentials (assign staff code + PIN)
  @Post('staff/:id/checkin')
  @Roles('super_admin', 'admin', 'branch_manager')
  setStaffCheckin(@Param('id') id: string, @Body() body: any) {
    return this.adminService.setStaffCheckin(id, body);
  }

  @Get('staff/:id/badge-qr')
  @Roles('super_admin', 'admin', 'branch_manager')
  badgeQr(@Param('id') id: string) {
    return this.adminService.badgeQr(id);
  }

  // Products
  @Get('products')
  listProducts() {
    return this.adminService.listProducts();
  }

  @Post('products')
  @Roles('super_admin', 'admin', 'branch_manager')
  createProduct(@CurrentUser() user: any, @Body() body: any) {
    return this.adminService.createProduct(user, body);
  }

  @Patch('products/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  updateProduct(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.updateProduct(user, id, body);
  }

  // Global price control — per-size prices for one/all branches.
  @Put('products/:id/prices')
  @Roles('super_admin', 'admin', 'branch_manager')
  setProductPrices(@CurrentUser() user: any, @Param('id') id: string, @Body() body: any) {
    return this.adminService.setProductPrices(user, id, body);
  }

  // Branches
  @Get('branches')
  listBranches() {
    return this.adminService.listBranches();
  }

  @Post('branches')
  @Roles('super_admin', 'admin')
  createBranch(@Body() body: any) {
    return this.adminService.createBranch(body);
  }

  @Patch('branches/:id')
  @Roles('super_admin', 'admin')
  updateBranch(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateBranch(id, body);
  }

  // Soft archive: flips the branch to `inactive`; reactivate via PATCH.
  @Delete('branches/:id')
  @Roles('super_admin', 'admin')
  deleteBranch(@Param('id') id: string) {
    return this.adminService.deleteBranch(id);
  }

  // Customers
  @Get('customers')
  listCustomers() {
    return this.adminService.listCustomers();
  }

  @Post('customers')
  @Roles('super_admin', 'admin', 'branch_manager')
  createCustomer(@Body() body: any) {
    return this.adminService.createCustomer(body);
  }

  @Patch('customers/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  updateCustomer(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateCustomer(id, body);
  }

  @Delete('customers/:id')
  @Roles('super_admin', 'admin')
  deleteCustomer(@Param('id') id: string) {
    return this.adminService.deleteCustomer(id);
  }

  // Deliveries
  @Get('riders')
  listRiders() {
    return this.adminService.listRiders();
  }

  @Get('deliveries')
  listDeliveries() {
    return this.adminService.listDeliveries();
  }

  @Patch('deliveries/:id/assign')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  assignRider(@Param('id') id: string, @Body() body: any) {
    return this.adminService.assignRider(id, body);
  }

  @Patch('deliveries/:id/status')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  updateDeliveryStatus(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateDeliveryStatus(id, body);
  }

  // Attendance
  @Get('attendance')
  listAttendance() {
    return this.adminService.listAttendance();
  }

  // Manual corrections by managers; soft delete keeps payroll history sane.
  @Post('attendance')
  @Roles('super_admin', 'admin', 'branch_manager')
  createAttendance(@Body() body: any) {
    return this.adminService.createAttendance(body);
  }

  @Patch('attendance/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  updateAttendance(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateAttendance(id, body);
  }

  @Delete('attendance/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  deleteAttendance(@Param('id') id: string) {
    return this.adminService.deleteAttendance(id);
  }

  // Inventory
  @Get('inventory')
  listInventory() {
    return this.adminService.listInventory();
  }

  @Post('inventory/adjust')
  @Roles('super_admin', 'admin', 'branch_manager', 'staff')
  adjustInventory(@Body() body: any) {
    return this.adminService.adjustInventory(body);
  }

  @Post('inventory/items')
  @Roles('super_admin', 'admin', 'branch_manager')
  createInventoryItem(@Body() body: any) {
    return this.adminService.createInventory(body);
  }

  @Patch('inventory/items/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  updateInventoryItem(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateInventory(id, body);
  }

  @Delete('inventory/items/:id')
  @Roles('super_admin', 'admin', 'branch_manager')
  deleteInventoryItem(@Param('id') id: string) {
    return this.adminService.deleteInventory(id);
  }
}
