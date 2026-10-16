import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { generateStaffCode, signBadgeToken } from '../attendance/checkin-token';
import {
  num,
  CATEGORY_TO_UI,
  CATEGORY_TO_DB,
  ORDER_STATUS_TO_UI,
  ORDER_STATUS_TO_DB,
  DELIVERY_STATUS_TO_UI,
  DELIVERY_STATUS_TO_DB,
  ROLE_TO_UI,
  ROLE_TO_DB,
  inventoryStatus,
} from './admin.maps';

// ─── Small helpers ───────────────────────────────────────
function splitName(full: string | null | undefined) {
  const parts = (full ?? '').trim().split(/\s+/);
  const firstName = parts.shift() ?? '';
  const lastName = parts.join(' ');
  return { firstName, lastName };
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // ─── Dashboard ─────────────────────────────────────────
  async dashboardStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalOrders, totalCustomers, activeBranches, revenueAgg, monthlyAgg] =
      await Promise.all([
        this.prisma.order.count(),
        this.prisma.customer.count(),
        this.prisma.branch.count({ where: { status: 'active' } }),
        this.prisma.order.aggregate({
          where: { paymentStatus: 'paid' },
          _sum: { totalAmount: true },
        }),
        this.prisma.order.aggregate({
          where: { paymentStatus: 'paid', createdAt: { gte: startOfMonth } },
          _sum: { totalAmount: true },
        }),
      ]);

    const [recent, lowStock] = await Promise.all([
      this.prisma.order.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { fullName: true } },
          branch: { select: { name: true } },
        },
      }),
      this.prisma.inventory.findMany({
        where: { quantityOnHand: { lte: 5 } },
        take: 6,
        orderBy: { quantityOnHand: 'asc' },
        include: {
          product: { select: { name: true } },
          branch: { select: { name: true } },
        },
      }),
    ]);

    return {
      totalOrders,
      totalRevenue: num(revenueAgg._sum.totalAmount),
      monthlyRevenue: num(monthlyAgg._sum.totalAmount),
      activeBranches,
      totalCustomers,
      orderTrend: '+0%',
      revenueTrend: '+0%',
      recentOrders: recent.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customer?.fullName ?? '—',
        total: num(o.totalAmount),
        status: ORDER_STATUS_TO_UI[o.status] ?? o.status,
        branchName: o.branch?.name ?? '—',
        createdAt: o.createdAt.toISOString(),
      })),
      lowStockItems: lowStock.map((i: any) => ({
        id: i.id,
        productName: i.product?.name ?? '—',
        branchName: i.branch?.name ?? '—',
        currentStock: i.quantityOnHand,
        minStock: i.minStockLevel,
        status: inventoryStatus(i.quantityOnHand, i.minStockLevel),
      })),
    };
  }

  // ─── Analytics (DB-side aggregation) ────────────────────
  // Builds the analytics object using indexed aggregate/groupBy queries
  // rather than loading every order into memory. Optional range filters
  // (branch + date window) let the unified dashboard drive everything.
  async analytics(query?: { branchId?: string; from?: string; to?: string }) {
    return this.computeAnalytics(query);
  }

  private endOfDay(d: string): Date {
    const date = new Date(d);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  // Shared engine behind analytics() and dashboard().
  private async computeAnalytics(query?: {
    branchId?: string;
    from?: string;
    to?: string;
  }) {
    const now = new Date();

    const scope: any = {};
    if (query?.branchId) scope.branchId = query.branchId;
    if (query?.from || query?.to) {
      scope.createdAt = {};
      if (query?.from) scope.createdAt.gte = new Date(query.from);
      if (query?.to) scope.createdAt.lte = this.endOfDay(query.to);
    }
    const paidScope = { ...scope, paymentStatus: 'paid' as const };

    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // 6-month series (oldest -> newest), each a DB-side range aggregate.
    const monthRanges = Array.from({ length: 6 }).map((_, idx) => {
      const back = 5 - idx;
      const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const to = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
      return { from, to, label: MONTHS[from.getMonth()] };
    });

    const [
      totalAgg,
      thisMonthAgg,
      lastMonthAgg,
      thisMonthOrders,
      lastMonthOrders,
      totalOrders,
      statusGrouped,
      branchOrderGrouped,
      branchRevenueGrouped,
      monthAggs,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: paidScope,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: { ...paidScope, createdAt: { gte: startThisMonth, lt: startNextMonth } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { ...paidScope, createdAt: { gte: startLastMonth, lt: startThisMonth } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({
        where: { ...scope, createdAt: { gte: startThisMonth, lt: startNextMonth } },
      }),
      this.prisma.order.count({
        where: { ...scope, createdAt: { gte: startLastMonth, lt: startThisMonth } },
      }),
      this.prisma.order.count({ where: scope }),
      this.prisma.order.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.order.groupBy({
        by: ['branchId'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({
        by: ['branchId'],
        where: paidScope,
        _sum: { totalAmount: true },
      }),
      Promise.all(
        monthRanges.map((r) =>
          this.prisma.order
            .aggregate({
              where: { ...paidScope, createdAt: { gte: r.from, lt: r.to } },
              _sum: { totalAmount: true },
              _count: { _all: true },
            })
            .then((a) => ({
              ...r,
              revenue: num(a._sum.totalAmount),
              orders: a._count._all,
            })),
        ),
      ),
    ]);

    const totalRevenue = num(totalAgg._sum.totalAmount);
    const thisMonthRevenue = num(thisMonthAgg._sum.totalAmount);
    const lastMonthRevenue = num(lastMonthAgg._sum.totalAmount);

    const growth = (cur: number, prev: number) => {
      if (!prev) return cur ? '+100%' : '+0%';
      const pct = ((cur - prev) / prev) * 100;
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    };

    const monthlyRevenue = monthAggs.map((m) => ({
      month: m.label,
      revenue: m.revenue,
      orders: m.orders,
    }));

    // Order status breakdown (bucketed to UI labels).
    const buckets: Record<string, number> = {
      Pending: 0,
      Processing: 0,
      Delivering: 0,
      Delivered: 0,
      Cancelled: 0,
    };
    const statusToBucket: Record<string, string> = {
      pending: 'Pending',
      confirmed: 'Processing',
      preparing: 'Processing',
      out_for_delivery: 'Delivering',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };
    for (const g of statusGrouped) {
      const b = statusToBucket[g.status as string];
      if (b) buckets[b] += g._count._all;
    }
    const statusTotal = Object.values(buckets).reduce((a, b) => a + b, 0) || 1;
    const orderStatusBreakdown = Object.entries(buckets).map(([status, count]) => ({
      status,
      count,
      percentage: Math.round((count / statusTotal) * 100),
    }));

    // Branch performance (merge order counts + paid revenue per branch).
    const branches = await this.prisma.branch.findMany({ select: { id: true, name: true } });
    const nameById: Record<string, string> = {};
    for (const b of branches) nameById[b.id] = b.name;
    const revById: Record<string, number> = {};
    for (const g of branchRevenueGrouped) revById[g.branchId] = num(g._sum.totalAmount);
    const branchPerformance = branchOrderGrouped
      .map((g) => ({
        branchName: nameById[g.branchId] ?? '—',
        orders: g._count._all,
        revenue: revById[g.branchId] ?? 0,
        growth: '+0%',
      }))
      .filter((b) => b.orders > 0)
      .sort((a, b) => b.revenue - a.revenue);

    // Top products.
    const grouped = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true, totalPrice: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: 6,
    });
    const productIds = grouped.map((g) => g.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    });
    const productNameById: Record<string, string> = {};
    for (const p of products) productNameById[p.id] = p.name;
    const topProducts = grouped.map((g) => ({
      name: productNameById[g.productId] ?? 'Unknown',
      quantity: g._sum.quantity ?? 0,
      revenue: num(g._sum.totalPrice),
    }));

    return {
      revenue: {
        total: totalRevenue,
        thisMonth: thisMonthRevenue,
        lastMonth: lastMonthRevenue,
        growth: growth(thisMonthRevenue, lastMonthRevenue),
      },
      orders: {
        total: totalOrders,
        thisMonth: thisMonthOrders,
        lastMonth: lastMonthOrders,
        growth: growth(thisMonthOrders, lastMonthOrders),
      },
      avgOrderValue: totalAgg._count._all
        ? Math.round(totalRevenue / totalAgg._count._all)
        : 0,
      branchPerformance,
      monthlyRevenue,
      orderStatusBreakdown,
      topProducts,
    };
  }

  // ─── Unified Dashboard (= analytics) ────────────────────
  async dashboard(query?: { branchId?: string; from?: string; to?: string }) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const analytics = await this.computeAnalytics(query);

    const [activeBranches, totalCustomers, clockedInNow] = await Promise.all([
      this.prisma.branch.count({ where: { status: 'active' } }),
      this.prisma.customer.count(),
      this.prisma.attendance.count({ where: { clockOut: null } }),
    ]);

    // Recent orders + low stock (respect branch scope for context).
    const scope: any = {};
    if (query?.branchId) scope.branchId = query.branchId;

    const [recent, lowStock] = await Promise.all([
      this.prisma.order.findMany({
        where: scope,
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { fullName: true } },
          branch: { select: { name: true } },
        },
      }),
      this.prisma.inventory.findMany({
        where: { quantityOnHand: { lte: 5 }, ...(query?.branchId ? { branchId: query.branchId } : {}) },
        take: 8,
        orderBy: { quantityOnHand: 'asc' },
        include: {
          product: { select: { name: true } },
          branch: { select: { name: true } },
        },
      }),
    ]);

    const monthlyStart = startOfMonth;
    const monthRevenueSeries = analytics.monthlyRevenue[analytics.monthlyRevenue.length - 1];

    return {
      kpis: {
        totalRevenue: analytics.revenue.total,
        monthlyRevenue: analytics.revenue.thisMonth,
        revenueGrowth: analytics.revenue.growth,
        totalOrders: analytics.orders.total,
        ordersGrowth: analytics.orders.growth,
        avgOrderValue: analytics.avgOrderValue,
        activeBranches,
        totalCustomers,
        clockedInNow,
        monthRevenueLabel: monthRevenueSeries?.month ?? MONTHS[monthlyStart.getMonth()],
      },
      analytics,
      recentOrders: recent.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customer?.fullName ?? '—',
        total: num(o.totalAmount),
        status: ORDER_STATUS_TO_UI[o.status] ?? o.status,
        branchName: o.branch?.name ?? '—',
        createdAt: o.createdAt.toISOString(),
      })),
      lowStockItems: lowStock.map((i: any) => ({
        id: i.id,
        productName: i.product?.name ?? '—',
        branchName: i.branch?.name ?? '—',
        currentStock: i.quantityOnHand,
        minStock: i.minStockLevel,
        status: inventoryStatus(i.quantityOnHand, i.minStockLevel),
      })),
    };
  }

  // ─── Orders ────────────────────────────────────────────
  async listOrders(query: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    branchId?: string;
  }) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 20);
    const where: any = {};
    if (query.branchId) where.branchId = query.branchId;
    if (query.status && query.status !== 'all') {
      where.status = ORDER_STATUS_TO_DB[query.status] ?? query.status;
    }
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { fullName: true, phone: true } },
          branch: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders: rows.map((o: any) => this.mapOrderSummary(o)),
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private mapOrderSummary(o: any) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer?.fullName ?? '—',
      customerPhone: o.customer?.phone ?? '',
      total: num(o.totalAmount),
      status: ORDER_STATUS_TO_UI[o.status] ?? o.status,
      branchName: o.branch?.name ?? '—',
      orderType: o.orderType,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod ?? '',
      deliveryFee: num(o.deliveryFee),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        customer: { select: { fullName: true, email: true, phone: true, address: true } },
        branch: { select: { name: true } },
        delivery: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const timeline: { status: string; timestamp: string; note?: string }[] = [
      { status: 'pending', timestamp: order.createdAt.toISOString(), note: 'Order placed' },
    ];
    if (['confirmed', 'preparing', 'out_for_delivery', 'delivered'].includes(order.status)) {
      timeline.push({ status: 'confirmed', timestamp: order.updatedAt.toISOString() });
    }
    if (['out_for_delivery', 'delivered'].includes(order.status)) {
      timeline.push({ status: 'delivering', timestamp: order.updatedAt.toISOString() });
    }
    if (order.deliveredAt) {
      timeline.push({ status: 'delivered', timestamp: order.deliveredAt.toISOString() });
    }
    if (order.cancelledAt) {
      timeline.push({
        status: 'cancelled',
        timestamp: order.cancelledAt.toISOString(),
        note: order.cancelReason ?? undefined,
      });
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: ORDER_STATUS_TO_UI[order.status] ?? order.status,
      customerName: order.customer?.fullName ?? '—',
      customerEmail: order.customer?.email ?? '',
      customerPhone: order.customer?.phone ?? '',
      deliveryAddress: (order as any).delivery?.deliveryAddress ?? order.customer?.address ?? '',
      branchName: order.branch?.name ?? '—',
      paymentMethod: order.paymentMethod ?? '',
      subtotal: num(order.subtotal),
      deliveryFee: num(order.deliveryFee),
      total: num(order.totalAmount),
      notes: order.notes ?? '',
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((it: any) => ({
        id: it.id,
        productName: it.product?.name ?? 'Item',
        quantity: it.quantity,
        unitPrice: num(it.unitPrice),
        totalPrice: num(it.totalPrice),
      })),
      timeline,
    };
  }

  async updateOrderStatus(id: string, body: any) {
    const dbStatus =
      ORDER_STATUS_TO_DB[body?.status] ?? body?.status;
    const data: any = { status: dbStatus };
    if (dbStatus === 'cancelled') {
      data.cancelledAt = new Date();
      data.cancelReason = body?.cancelReason;
    }
    if (dbStatus === 'delivered') data.deliveredAt = new Date();
    const updated = await this.prisma.order.update({
      where: { id },
      data,
      include: { customer: true, branch: true },
    });
    return this.mapOrderSummary(updated);
  }

  // ─── Staff ─────────────────────────────────────────────
  async listStaff() {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'branch_manager', 'staff', 'rider'] } },
      orderBy: { createdAt: 'desc' },
      include: { branch: { select: { name: true } } },
    });
    return { staff: rows.map((s: any) => this.mapStaff(s)) };
  }

  private mapStaff(s: any) {
    const { firstName, lastName } = splitName(s.fullName);
    return {
      id: s.id,
      firstName,
      lastName,
      email: s.email,
      phone: s.phone ?? '',
      role: ROLE_TO_UI[s.role] ?? 'staff',
      branchName: s.branch?.name ?? 'Head Office',
      isActive: s.status === 'active',
      jobTitle: s.jobTitle ?? '',
      baseSalary: s.baseSalary != null ? Number(s.baseSalary) : null,
      staffCode: s.staffCode ?? '',
      lastLogin: (s.lastLogin ?? s.updatedAt ?? s.createdAt).toISOString(),
      createdAt: s.createdAt.toISOString(),
    };
  }

  private async resolveBranchId(name?: string) {
    if (!name || !name.trim()) return null;
    const branch = await this.prisma.branch.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    return branch?.id ?? null;
  }

  async createStaff(body: any) {
    const fullName = `${body.firstName ?? ''} ${body.lastName ?? ''}`.trim();
    const branchId = await this.resolveBranchId(body.branchName);
    const role = ROLE_TO_DB[body.role] ?? 'staff';
    const password = body.password && body.password.trim() ? body.password : 'changeme123';
    const created = await this.prisma.user.create({
      data: {
        email: body.email,
        password: await bcrypt.hash(password, 12),
        fullName: fullName || body.email,
        phone: body.phone || null,
        role: role as any,
        branchId,
        jobTitle: body.jobTitle?.trim() || null,
        baseSalary: body.baseSalary ? Number(body.baseSalary) : null,
      },
      include: { branch: { select: { name: true } } },
    });
    return this.mapStaff(created);
  }

  async updateStaff(id: string, body: any) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Staff member not found');

    const data: any = {};
    if (body.firstName || body.lastName) {
      const first = body.firstName ?? splitName(existing.fullName).firstName;
      const last = body.lastName ?? splitName(existing.fullName).lastName;
      data.fullName = `${first} ${last}`.trim();
    }
    if (body.email) data.email = body.email;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.role) data.role = ROLE_TO_DB[body.role] ?? 'staff';
    if (body.branchName !== undefined) data.branchId = await this.resolveBranchId(body.branchName);
    if (typeof body.isActive === 'boolean') data.status = body.isActive ? 'active' : 'inactive';
    if (body.jobTitle !== undefined) data.jobTitle = body.jobTitle?.trim() || null;
    if (body.baseSalary !== undefined && body.baseSalary !== '') data.baseSalary = Number(body.baseSalary);
    if (body.password && body.password.trim()) data.password = await bcrypt.hash(body.password, 12);

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      include: { branch: { select: { name: true } } },
    });
    return this.mapStaff(updated);
  }

  // ─── Anti-fraud check-in credentials + badge ───────────
  // Assign (or rotate) a staff's code and secret PIN. The code identifies the
  // person at the terminal; the PIN is the knowledge factor, stored as bcrypt.
  async setStaffCheckin(id: string, body: any) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Staff member not found');

    let staffCode = (body?.staffCode ?? '').trim() || existing.staffCode;
    if (!staffCode) staffCode = generateStaffCode();

    const data: any = { staffCode };
    if (body?.pin && String(body.pin).trim()) {
      const pin = String(body.pin).trim();
      if (pin.length < 4 || pin.length > 8) {
        throw new BadRequestException('PIN must be between 4 and 8 characters');
      }
      data.pinHash = await bcrypt.hash(pin, 12);
    }

    const updated = await this.prisma.user.update({ where: { id }, data });
    return {
      staffCode: updated.staffCode,
      pinSet: !!updated.pinHash,
      updated_at: updated.updatedAt.toISOString(),
    };
  }

  // Produce a signed badge QR for ID-card printing (used by check-in too).
  async badgeQr(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Staff member not found');

    let staffCode = user.staffCode;
    if (!staffCode) {
      staffCode = generateStaffCode();
      await this.prisma.user.update({ where: { id }, data: { staffCode } });
    }
    const token = signBadgeToken(user.id, staffCode);
    const dataUrl = await QRCode.toDataURL(token, { margin: 1, width: 320 });
    return { staffCode, token, dataUrl };
  }

  // ─── Products ──────────────────────────────────────────
  async listProducts() {
    const rows = await this.prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
    return { products: rows.map((p: any) => this.mapProduct(p)) };
  }

  private mapProduct(p: any) {
    return {
      id: p.id,
      name: p.name,
      description: p.description ?? '',
      category: CATEGORY_TO_UI[p.category] ?? p.category,
      price: num(p.basePrice),
      weight: p.sizes && p.sizes.length ? `${p.sizes[0]}kg` : undefined,
      sizes: Array.isArray(p.sizes) ? p.sizes.map((s: any) => Number(s)) : [],
      isActive: p.isActive,
      imageUrl: p.imageUrl ?? undefined,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private productData(body: any) {
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.category !== undefined)
      data.category = CATEGORY_TO_DB[body.category] ?? body.category;
    if (body.price !== undefined) data.basePrice = Number(body.price) || 0;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.weight !== undefined && body.weight !== '') {
      const kg = parseFloat(String(body.weight));
      if (!Number.isNaN(kg)) data.sizes = [kg];
    }
    return data;
  }

  async createProduct(body: any) {
    const data = this.productData(body);
    const created = await this.prisma.product.create({
      data: {
        ...data,
        category: data.category ?? 'refill',
      },
    });
    return this.mapProduct(created);
  }

  async updateProduct(id: string, body: any) {
    const updated = await this.prisma.product.update({
      where: { id },
      data: this.productData(body),
    });
    return this.mapProduct(updated);
  }

  // Global price control: upsert per-size ProductPrice rows for one product
  // across either one branch or every active branch. Rows take effect
  // immediately for the website catalog, POS and server-side order pricing.
  async setProductPrices(id: string, body: any) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const entries: { sizeKg: number; price: number }[] = (
      Array.isArray(body?.entries) ? body.entries : []
    )
      .map((e: any) => ({ sizeKg: Number(e.sizeKg), price: Number(e.price) }))
      .filter(
        (e: any) =>
          Number.isFinite(e.sizeKg) && e.sizeKg >= 0 && Number.isFinite(e.price) && e.price >= 0,
      );
    if (!entries.length) {
      throw new BadRequestException('No valid price entries supplied');
    }

    const branchIds: string[] = body?.allBranches
      ? (
          await this.prisma.branch.findMany({
            where: { status: 'active' },
            select: { id: true },
          })
        ).map((b) => b.id)
      : body?.branchId
        ? [String(body.branchId)]
        : [];
    if (!branchIds.length) {
      throw new BadRequestException('Pick a branch or apply to all branches');
    }

    let upserted = 0;
    for (const branchId of branchIds) {
      for (const entry of entries) {
        const existing = await this.prisma.productPrice.findFirst({
          where: { productId: id, branchId, sizeKg: entry.sizeKg },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (existing) {
          await this.prisma.productPrice.update({
            where: { id: existing.id },
            data: { price: entry.price },
          });
        } else {
          await this.prisma.productPrice.create({
            data: {
              productId: id,
              branchId,
              sizeKg: entry.sizeKg,
              price: entry.price,
              effectiveFrom: new Date(),
            },
          });
        }
        upserted += 1;
      }
    }

    // Keep basePrice coherent: it anchors the per-kg fallback for sizes
    // without an override, so re-point it at the primary size's new price.
    const primary = Array.isArray(product.sizes) ? Number(product.sizes[0]) : null;
    const primaryEntry = entries.find((e) => Number(e.sizeKg) === primary);
    if (primaryEntry) {
      // Per-kg products: normalise basePrice back to the primary size axis.
      await this.prisma.product.update({
        where: { id },
        data: { basePrice: primaryEntry.price },
      });
    }

    return { upserted, branches: branchIds.length };
  }

  // ─── Branches ──────────────────────────────────────────
  async listBranches() {
    const rows = await this.prisma.branch.findMany({ orderBy: { createdAt: 'asc' } });
    return {
      branches: rows.map((b: any) => ({
        id: b.id,
        name: b.name,
        address: b.address ?? '',
        city: b.city ?? '',
        phone: b.phone ?? '',
        email: b.email ?? '',
        isActive: b.status === 'active',
        managerName: b.managerName ?? undefined,
        latitude: b.latitude ?? null,
        longitude: b.longitude ?? null,
        deliveryRadiusKm: Number(b.deliveryRadiusKm ?? 25),
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }

  private branchData(body: any) {
    const data: any = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.address !== undefined) data.address = body.address;
    if (body.city !== undefined) data.city = body.city || null;
    if (body.managerName !== undefined) data.managerName = body.managerName || null;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.email !== undefined) data.email = body.email;
    if (typeof body.isActive === 'boolean') data.status = body.isActive ? 'active' : 'inactive';
    // Zone delivery pricing needs coordinates + radius on the branch.
    if (body.latitude !== undefined && body.latitude !== null && body.latitude !== '')
      data.latitude = Number(body.latitude);
    if (body.longitude !== undefined && body.longitude !== null && body.longitude !== '')
      data.longitude = Number(body.longitude);
    if (body.deliveryRadiusKm !== undefined && body.deliveryRadiusKm !== null && body.deliveryRadiusKm !== '')
      data.deliveryRadiusKm = Number(body.deliveryRadiusKm);
    return data;
  }

  private branchRow(b: any) {
    return {
      id: b.id,
      name: b.name,
      address: b.address ?? '',
      city: b.city ?? '',
      phone: b.phone ?? '',
      email: b.email ?? '',
      isActive: b.status === 'active',
      managerName: b.managerName ?? undefined,
      createdAt: b.createdAt.toISOString(),
    };
  }

  async createBranch(body: any) {
    const created = await this.prisma.branch.create({
      data: { ...this.branchData(body), address: body.address ?? '' },
    });
    return this.branchRow(created);
  }

  async updateBranch(id: string, body: any) {
    const updated = await this.prisma.branch.update({
      where: { id },
      data: this.branchData(body),
    });
    return this.branchRow(updated);
  }

  // ─── Customers ─────────────────────────────────────────
  async listCustomers() {
    const rows = await this.prisma.customer.findMany({ orderBy: { createdAt: 'desc' } });
    return {
      customers: rows.map((c: any) => {
        const { firstName, lastName } = splitName(c.fullName);
        return {
          id: c.id,
          firstName,
          lastName,
          email: c.email,
          phone: c.phone ?? '',
          address: c.address ?? '',
          totalOrders: c.orderCount,
          totalSpent: num(c.totalSpent),
          lastOrderDate: c.updatedAt.toISOString(),
          createdAt: c.createdAt.toISOString(),
        };
      }),
    };
  }

  // ─── Deliveries ────────────────────────────────────────
  async listRiders() {
    const rows = await this.prisma.user.findMany({
      where: { role: 'rider', status: 'active' },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        phone: true,
        branch: { select: { name: true } },
      },
    });
    return {
      riders: rows.map((r: any) => ({
        id: r.id,
        name: r.fullName,
        phone: r.phone ?? '',
        branchName: r.branch?.name ?? '—',
      })),
    };
  }

  async listDeliveries() {
    const rows = await this.prisma.delivery.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: { include: { customer: { select: { fullName: true, phone: true } } } },
        pickupBranch: { select: { name: true } },
      },
    });

    const riderIds = Array.from(new Set(rows.map((r: any) => r.riderId).filter(Boolean)));
    const riders = riderIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: riderIds } },
          select: { id: true, fullName: true, phone: true },
        })
      : [];
    const riderById: Record<string, { name: string; phone: string }> = {};
    for (const r of riders) riderById[r.id] = { name: r.fullName, phone: r.phone ?? '' };

    return {
      deliveries: rows.map((d: any) => {
        const rider = riderById[d.riderId];
        return {
          id: d.id,
          orderNumber: d.order?.orderNumber ?? '—',
          customerName: d.order?.customer?.fullName ?? '—',
          customerPhone: d.order?.customer?.phone ?? '',
          deliveryAddress: d.deliveryAddress ?? '',
          riderName: rider?.name ?? 'Unassigned',
          riderPhone: rider?.phone ?? '',
          branchName: d.pickupBranch?.name ?? '—',
          status: DELIVERY_STATUS_TO_UI[d.status] ?? d.status,
          assignedAt: d.createdAt.toISOString(),
          estimatedDelivery: (d.deliveredAt ?? d.updatedAt).toISOString(),
          deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : undefined,
        };
      }),
    };
  }

  async assignRider(id: string, body: any) {
    let riderId: string | undefined;
    if (body?.riderPhone || body?.riderName) {
      const rider = await this.prisma.user.findFirst({
        where: {
          role: 'rider',
          ...(body.riderPhone ? { phone: body.riderPhone } : {}),
        },
      });
      riderId = rider?.id;
    }
    if (!riderId) throw new NotFoundException('No matching rider found');
    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { riderId, status: 'assigned' },
      include: { order: { select: { orderNumber: true } } },
    });
    void this.push.notifyRidersAssigned(riderId, {
      orderNumber: updated.order?.orderNumber,
      address: updated.deliveryAddress,
    });
    return { id: updated.id, riderId, status: 'pending' };
  }

  async updateDeliveryStatus(id: string, body: any) {
    const dbStatus = DELIVERY_STATUS_TO_DB[body?.status] ?? body?.status;
    const data: any = { status: dbStatus };
    if (dbStatus === 'delivered') data.deliveredAt = new Date();
    const updated = await this.prisma.delivery.update({ where: { id }, data });
    return {
      id: updated.id,
      status: DELIVERY_STATUS_TO_UI[updated.status] ?? updated.status,
    };
  }

  // ─── Attendance ────────────────────────────────────────
  async listAttendance() {
    const rows = await this.prisma.attendance.findMany({
      orderBy: { clockIn: 'desc' },
      take: 200,
      include: {
        user: { select: { fullName: true, email: true } },
        branch: { select: { name: true } },
      },
    });
    return {
      records: rows.map((a: any) => ({
        id: a.id,
        staffName: a.user?.fullName ?? '—',
        staffEmail: a.user?.email ?? '',
        branchName: a.branch?.name ?? '—',
        date: a.clockIn.toISOString().split('T')[0],
        clockIn: a.clockIn ? a.clockIn.toISOString() : null,
        clockOut: a.clockOut ? a.clockOut.toISOString() : null,
        status: a.clockOut ? 'clocked_out' : 'clocked_in',
        totalHours: num(a.totalHours),
      })),
    };
  }

  // ─── Inventory ─────────────────────────────────────────
  async listInventory() {
    const rows = await this.prisma.inventory.findMany({
      orderBy: { quantityOnHand: 'asc' },
      include: {
        product: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });
    return {
      inventory: rows.map((i: any) => ({
        id: i.id,
        productName: i.product?.name ?? '—',
        branchName: i.branch?.name ?? '—',
        branchId: i.branchId,
        currentStock: i.quantityOnHand,
        minStock: i.minStockLevel,
        maxStock: i.maxCapacity,
        status: inventoryStatus(i.quantityOnHand, i.minStockLevel),
        lastRestocked: (i.lastRestockedAt ?? i.updatedAt).toISOString(),
      })),
    };
  }

  async adjustInventory(body: any) {
    const item = await this.prisma.inventory.findUnique({
      where: { id: body.inventoryId },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    const delta = Number(body.quantity) || 0;
    const nextQty = Math.max(0, item.quantityOnHand + delta);
    const updated = await this.prisma.inventory.update({
      where: { id: item.id },
      data: {
        quantityOnHand: nextQty,
        ...(delta > 0 ? { lastRestockedAt: new Date() } : {}),
      },
    });
    return {
      id: updated.id,
      currentStock: updated.quantityOnHand,
      status: inventoryStatus(updated.quantityOnHand, updated.minStockLevel),
    };
  }
}
