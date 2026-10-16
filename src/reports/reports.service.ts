import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { GasService } from '../gas/gas.service';
import { PayrollService } from '../payroll/payroll.service';
import {
  ReportQueryDto,
  toRange,
  parseIds,
  type ReportDataset,
} from './dto/report.dto';
import { renderCsv, renderDocx, renderPdf, renderXlsx, renderDocumentPdf } from './reports.renderers';
import {
  num,
  money,
  CATEGORY_TO_UI,
  CATEGORY_TO_DB,
  ORDER_STATUS_TO_UI,
  ORDER_STATUS_TO_DB,
  DELIVERY_STATUS_TO_UI,
  DELIVERY_STATUS_TO_DB,
  ROLE_TO_UI,
  ROLE_TO_DB,
  inventoryStatus,
} from '../admin/admin.maps';

function day(d: Date | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('en-NG') : '—';
}
function dt(d: Date | null | undefined): string {
  return d
    ? new Date(d).toLocaleString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}

function rangeLabel(q: ReportQueryDto): string {
  if (q.from && q.to) return `${day(new Date(q.from))} – ${day(new Date(q.to))}`;
  if (q.from) return `from ${day(new Date(q.from))}`;
  if (q.to) return `up to ${day(new Date(q.to))}`;
  return 'All time';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the POS list scoping: only global admins see across branches.
const PRIVILEGED_ROLES = new Set(['super_admin', 'admin']);

interface AuthUser {
  id: string;
  role: string;
  branchId?: string | null;
}

// Governance datasets that are strictly admin-only.
const ADMIN_ONLY_KINDS = new Set(['audit', 'payroll', 'branches', 'staff']);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gas: GasService,
    private readonly payroll: PayrollService,
  ) {}

  // ─── Data builders ─────────────────────────────────────
  private async salesData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = {};
    const range = toRange(q.from, q.to);
    if (Object.keys(range).length) where.createdAt = range;
    if (q.branchId) where.branchId = q.branchId;

    const [orders, agg] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          customer: { select: { fullName: true } },
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 2000,
      }),
      this.prisma.order.aggregate({ where, _sum: { totalAmount: true }, _count: true }),
    ]);

    return {
      title: 'Sales Report',
      subtitle: `Orders · ${rangeLabel(q)}`,
      meta: [
        { label: 'Orders', value: String(agg._count) },
        { label: 'Gross sales (₦)', value: money(Number(agg._sum.totalAmount ?? 0)).toLocaleString('en-NG') },
      ],
      headers: ['Order #', 'Date', 'Customer', 'Branch', 'Status', 'Payment', 'Method', 'Total (₦)'],
      rows: orders.map((o: any) => [
        o.orderNumber,
        day(o.createdAt),
        o.customer?.fullName ?? '—',
        o.branch?.name ?? '—',
        o.status,
        o.paymentStatus,
        o.paymentMethod ?? '—',
        money(Number(o.totalAmount)),
      ]),
      numericCols: [7],
    };
  }

  private async gasData(q: ReportQueryDto): Promise<ReportDataset> {
    const b = await this.gas.balance({ branchId: q.branchId, from: q.from, to: q.to } as any);
    const branchName = q.branchId
      ? (await this.prisma.branch.findUnique({ where: { id: q.branchId } }))?.name ?? 'Branch'
      : 'All branches';

    return {
      title: 'Gas Balance Report',
      subtitle: `LPG mass balance · ${branchName} · ${rangeLabel(q)}`,
      meta: [
        { label: 'Balance status', value: b.status.toUpperCase() },
        { label: 'Variance (%)', value: String(b.variancePct) },
      ],
      headers: ['Metric', 'Value (kg)'],
      rows: [
        ['Opening stock', b.openingKg],
        ['Purchases (in)', b.purchasesKg],
        ['Dispensed / filled (out)', b.dispensedKg],
        ['Expected closing', b.expectedClosingKg],
        ['Actual closing (tank reading)', b.hasActual ? b.actualClosingKg : 'No reading'],
        ['Variance (shrinkage if negative)', b.varianceKg],
        ['Current on hand', b.currentOnHandKg],
      ],
      numericCols: [1],
    };
  }

  private async attendanceData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = {};
    const range = toRange(q.from, q.to);
    if (Object.keys(range).length) where.clockIn = range;
    const bid = await this.resolveBranchId(q.branchId);
    if (bid) where.branchId = bid;
    if (q.search) {
      where.user = {
        OR: [
          { fullName: { contains: q.search, mode: 'insensitive' } },
          { email: { contains: q.search, mode: 'insensitive' } },
        ],
      };
    }

    const rows = await this.prisma.attendance.findMany({
      where,
      include: {
        user: { select: { fullName: true } },
        branch: { select: { name: true } },
      },
      orderBy: { clockIn: 'desc' },
      take: 3000,
    });

    return {
      title: 'Attendance Report',
      subtitle: `Check-in log · ${rangeLabel(q)}`,
      meta: [{ label: 'Records', value: String(rows.length) }],
      headers: ['Staff', 'Branch', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Verified', 'Status'],
      rows: rows.map((a: any) => [
        a.user?.fullName ?? '—',
        a.branch?.name ?? '—',
        day(a.clockIn),
        new Date(a.clockIn).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
        a.clockOut
          ? new Date(a.clockOut).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })
          : '—',
        Number(a.totalHours ?? 0),
        a.verificationMethod ?? 'manual',
        a.status,
      ]),
      numericCols: [5],
    };
  }

  private async payrollData(q: ReportQueryDto): Promise<ReportDataset> {
    const period = q.period ?? q.from;
    const { payslips, totals } = await this.payroll.listPayroll({
      branchId: q.branchId,
      period,
    } as any);

    return {
      title: 'Payroll Report',
      subtitle: `Payslips · ${period ?? 'current period'}`,
      meta: [
        { label: 'Payslips', value: String(totals.count) },
        { label: 'Gross (₦)', value: money(totals.gross).toLocaleString('en-NG') },
        { label: 'Net payable (₦)', value: money(totals.net).toLocaleString('en-NG') },
      ],
      headers: ['Staff', 'Branch', 'Period', 'Basic', 'Allowances', 'Overtime', 'Bonus', 'Deductions', 'Net (₦)', 'Status'],
      rows: payslips.map((p: any) => [
        p.staffName,
        p.branchName,
        p.period,
        money(p.basicSalary),
        money(p.allowances),
        money(p.overtimePay),
        money(p.bonus),
        money(p.deductions),
        money(p.net),
        p.status,
      ]),
      numericCols: [3, 4, 5, 6, 7, 8],
    };
  }

  // ─── List-dataset builders (mirror the dashboard tables) ────────
  // Shared scope: optional explicit row selection + inclusive date window.
  private listWhere(q: ReportQueryDto, dateField = 'createdAt'): any {
    const where: any = {};
    const range = toRange(q.from, q.to);
    if (Object.keys(range).length) where[dateField] = range;
    const ids = parseIds(q.ids);
    if (ids.length) where.id = { in: ids };
    return where;
  }

  // Some dashboard selects filter by branch NAME (derived from rows) while the
  // API is scoped by branch ID. Accept either so the export matches the view.
  private async resolveBranchId(idOrName?: string): Promise<string | null> {
    if (!idOrName || idOrName === 'all') return null;
    if (UUID_RE.test(idOrName)) return idOrName;
    const b = await this.prisma.branch.findFirst({
      where: { name: { contains: idOrName, mode: 'insensitive' } },
      select: { id: true },
    });
    return b?.id ?? '__no_branch__';
  }

  private split(full: string | null | undefined) {
    const parts = (full ?? '').trim().split(/\s+/);
    const firstName = parts.shift() ?? '';
    return { firstName, lastName: parts.join(' ') };
  }

  private async ordersData(q: ReportQueryDto, walkInOnly: boolean): Promise<ReportDataset> {
    const where = this.listWhere(q);
    if (q.branchId) where.branchId = q.branchId;
    if (walkInOnly) where.orderType = 'walk_in';
    if (q.staffId) where.createdBy = q.staffId;
    if (q.status && q.status !== 'all') where.status = ORDER_STATUS_TO_DB[q.status] ?? q.status;
    if (q.search) {
      where.OR = [
        { orderNumber: { contains: q.search, mode: 'insensitive' } },
        { customer: { fullName: { contains: q.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: q.search } } },
      ];
    }
    const rows = await this.prisma.order.findMany({
      where,
      include: {
        customer: { select: { fullName: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const agg = await this.prisma.order.aggregate({ where, _sum: { totalAmount: true } });
    return {
      title: walkInOnly ? 'POS Sales Report' : 'Orders Report',
      subtitle: `${walkInOnly ? 'Counter sales' : 'All orders'} · ${rangeLabel(q)}`,
      meta: [
        { label: 'Records', value: String(rows.length) },
        { label: 'Total (₦)', value: money(Number(agg._sum.totalAmount ?? 0)).toLocaleString('en-NG') },
      ],
      headers: ['Order #', 'Date', 'Customer', 'Branch', 'Status', 'Payment', 'Method', 'Total (₦)'],
      rows: rows.map((o: any) => [
        o.orderNumber,
        dt(o.createdAt),
        o.customer?.fullName ?? '—',
        o.branch?.name ?? '—',
        ORDER_STATUS_TO_UI[o.status] ?? o.status,
        o.paymentStatus,
        o.paymentMethod ?? '—',
        money(Number(o.totalAmount)),
      ]),
      numericCols: [7],
    };
  }

  private async customersData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = {};
    const ids = parseIds(q.ids);
    if (ids.length) where.id = { in: ids };
    if (q.search) {
      where.OR = [
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { phone: { contains: q.search } },
      ];
    }
    const rows = await this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
    return {
      title: 'Customers Report',
      subtitle: `Registered customers · ${rows.length} record(s)`,
      meta: [{ label: 'Customers', value: String(rows.length) }],
      headers: ['Customer', 'Email', 'Phone', 'Orders', 'Total Spent (₦)', 'Joined'],
      rows: rows.map((c: any) => {
        const n = this.split(c.fullName);
        return [
          `${n.firstName} ${n.lastName}`.trim(),
          c.email ?? '',
          c.phone ?? '',
          c.orderCount,
          money(num(c.totalSpent)),
          day(c.createdAt),
        ];
      }),
      numericCols: [3, 4],
    };
  }

  private async productsData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = {};
    const ids = parseIds(q.ids);
    if (ids.length) where.id = { in: ids };
    if (q.status === 'active') where.isActive = true;
    else if (q.status === 'inactive') where.isActive = false;
    if (q.category && q.category !== 'all') where.category = CATEGORY_TO_DB[q.category] ?? q.category;
    if (q.search) {
      // Match the on-screen search: name OR description.
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { description: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.product.findMany({ where, orderBy: { createdAt: 'desc' } });
    return {
      title: 'Products Report',
      subtitle: `Catalogue · ${rows.length} product(s)`,
      meta: [{ label: 'Products', value: String(rows.length) }],
      headers: ['Product', 'Category', 'Base Price (₦)', 'Sizes', 'Status', 'Created'],
      rows: rows.map((p: any) => [
        p.name,
        CATEGORY_TO_UI[p.category] ?? p.category,
        money(num(p.basePrice)),
        (p.sizes ?? []).map((s: any) => `${s}kg`).join(', '),
        p.isActive ? 'active' : 'inactive',
        day(p.createdAt),
      ]),
      numericCols: [2],
    };
  }

  private async inventoryData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = {};
    const ids = parseIds(q.ids);
    if (ids.length) where.id = { in: ids };
    const bid = await this.resolveBranchId(q.branchId);
    if (bid) where.branchId = bid;
    const rows = await this.prisma.inventory.findMany({
      where,
      include: { product: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: { quantityOnHand: 'asc' },
    });
    let mapped = rows.map((i: any) => ({
      product: i.product?.name ?? '—',
      branch: i.branch?.name ?? '—',
      onHand: i.quantityOnHand,
      min: i.minStockLevel,
      max: i.maxCapacity,
      status: inventoryStatus(i.quantityOnHand, i.minStockLevel),
      last: (i.lastRestockedAt ?? i.updatedAt).toISOString(),
    }));
    if (q.status && q.status !== 'all') mapped = mapped.filter((m) => m.status === q.status);
    if (q.search) {
      const s = q.search.toLowerCase();
      // Mirror the on-screen search: matches product OR branch name.
      mapped = mapped.filter(
        (m) => m.product.toLowerCase().includes(s) || m.branch.toLowerCase().includes(s),
      );
    }
    return {
      title: 'Inventory Report',
      subtitle: `Stock levels · ${mapped.length} line(s)`,
      meta: [{ label: 'Items', value: String(mapped.length) }],
      headers: ['Product', 'Branch', 'On Hand', 'Min', 'Max', 'Status', 'Last Restocked'],
      rows: mapped.map((m) => [m.product, m.branch, m.onHand, m.min, m.max, m.status, day(m.last)]),
      numericCols: [2, 3, 4],
    };
  }

  private async deliveriesData(q: ReportQueryDto): Promise<ReportDataset> {
    const where = this.listWhere(q);
    if (q.branchId) where.pickupBranchId = q.branchId;
    if (q.status && q.status !== 'all') where.status = DELIVERY_STATUS_TO_DB[q.status] ?? q.status;
    if (q.search) {
      // Match the on-screen search: order no, customer OR rider name.
      const riderMatches = await this.prisma.user.findMany({
        where: { fullName: { contains: q.search, mode: 'insensitive' } },
        select: { id: true },
      });
      where.OR = [
        { order: { orderNumber: { contains: q.search, mode: 'insensitive' } } },
        { order: { customer: { fullName: { contains: q.search, mode: 'insensitive' } } } },
        ...(riderMatches.length ? [{ riderId: { in: riderMatches.map((r) => r.id) } }] : []),
      ];
    }
    const rows = await this.prisma.delivery.findMany({
      where,
      include: {
        order: { include: { customer: { select: { fullName: true } } } },
        pickupBranch: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const riderIds = Array.from(new Set(rows.map((r: any) => r.riderId).filter(Boolean)));
    const riders = riderIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: riderIds } }, select: { id: true, fullName: true } })
      : [];
    const riderById: Record<string, string> = {};
    for (const r of riders) riderById[r.id] = r.fullName;
    return {
      title: 'Deliveries Report',
      subtitle: `Delivery log · ${rows.length} record(s)`,
      meta: [{ label: 'Deliveries', value: String(rows.length) }],
      headers: ['Order #', 'Customer', 'Rider', 'Branch', 'Address', 'Status', 'Assigned', 'Delivered'],
      rows: rows.map((d: any) => [
        d.order?.orderNumber ?? '—',
        d.order?.customer?.fullName ?? '—',
        riderById[d.riderId] ?? 'Unassigned',
        d.pickupBranch?.name ?? '—',
        d.deliveryAddress ?? '',
        DELIVERY_STATUS_TO_UI[d.status] ?? d.status,
        dt(d.createdAt),
        d.deliveredAt ? dt(d.deliveredAt) : '—',
      ]),
      numericCols: [],
    };
  }

  private async staffData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = { role: { in: ['admin', 'branch_manager', 'staff', 'rider'] } };
    const ids = parseIds(q.ids);
    if (ids.length) where.id = { in: ids };
    const bid = await this.resolveBranchId(q.branchId);
    if (bid) where.branchId = bid;
    if (q.role && q.role !== 'all') {
      const dbRole = ROLE_TO_DB[q.role] ?? q.role;
      where.role = dbRole;
    }
    if (q.status === 'active') where.status = 'active';
    else if (q.status === 'inactive') where.status = 'inactive';
    if (q.search) {
      where.OR = [
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      include: { branch: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      title: 'Staff Report',
      subtitle: `Team directory · ${rows.length} member(s)`,
      meta: [{ label: 'Staff', value: String(rows.length) }],
      headers: ['Name', 'Email', 'Phone', 'Role', 'Branch', 'Status', 'Last Login'],
      rows: rows.map((s: any) => [
        s.fullName,
        s.email,
        s.phone ?? '',
        ROLE_TO_UI[s.role] ?? s.role,
        s.branch?.name ?? 'Head Office',
        s.status,
        s.lastLogin ? dt(s.lastLogin) : '—',
      ]),
      numericCols: [],
    };
  }

  private async branchesData(q: ReportQueryDto): Promise<ReportDataset> {
    const where: any = {};
    const ids = parseIds(q.ids);
    if (ids.length) where.id = { in: ids };
    if (q.status === 'active') where.status = 'active';
    else if (q.status === 'inactive') where.status = 'inactive';
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { city: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.branch.findMany({ where, orderBy: { createdAt: 'asc' } });
    return {
      title: 'Branches Report',
      subtitle: `Branch network · ${rows.length} location(s)`,
      meta: [{ label: 'Branches', value: String(rows.length) }],
      headers: ['Branch', 'Address', 'City', 'Phone', 'Email', 'Manager', 'Status'],
      rows: rows.map((b: any) => [
        b.name,
        b.address ?? '',
        b.city ?? '',
        b.phone ?? '',
        b.email ?? '',
        b.managerName ?? '—',
        b.status,
      ]),
      numericCols: [],
    };
  }

  private async announcementsData(q: ReportQueryDto): Promise<ReportDataset> {
    const where = this.listWhere(q);
    if (q.status && q.status !== 'all') where.status = q.status;
    if (q.type && q.type !== 'all') where.type = q.type;
    if (q.search) {
      where.OR = [
        { title: { contains: q.search, mode: 'insensitive' } },
        { body: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.announcement.findMany({ where, orderBy: { createdAt: 'desc' } });
    return {
      title: 'Announcements Report',
      subtitle: `Published updates · ${rows.length} item(s)`,
      meta: [{ label: 'Announcements', value: String(rows.length) }],
      headers: ['Title', 'Type', 'Status', 'Pinned', 'Starts', 'Ends', 'Published'],
      rows: rows.map((a: any) => [
        a.title,
        a.type,
        a.status,
        a.pinned ? 'Yes' : 'No',
        a.startsAt ? day(a.startsAt) : '—',
        a.endsAt ? day(a.endsAt) : '—',
        a.publishedAt ? day(a.publishedAt) : '—',
      ]),
      numericCols: [],
    };
  }

  private async messagesData(q: ReportQueryDto): Promise<ReportDataset> {
    const where = this.listWhere(q);
    if (q.status && q.status !== 'all') where.status = q.status;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { subject: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.contactMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
    return {
      title: 'Messages Report',
      subtitle: `Customer enquiries · ${rows.length} message(s)`,
      meta: [{ label: 'Messages', value: String(rows.length) }],
      headers: ['Name', 'Email', 'Phone', 'Subject', 'Status', 'Received', 'Replied'],
      rows: rows.map((m: any) => [
        m.name ?? '—',
        m.email ?? '',
        m.phone ?? '',
        m.subject ?? '',
        m.status,
        dt(m.createdAt),
        m.repliedAt ? dt(m.repliedAt) : '—',
      ]),
      numericCols: [],
    };
  }

  private async auditData(q: ReportQueryDto): Promise<ReportDataset> {
    const where = this.listWhere(q);
    if (q.status && q.status !== 'all') where.actionType = q.status;
    if (q.search) {
      where.OR = [
        { actorEmail: { contains: q.search, mode: 'insensitive' } },
        { actorName: { contains: q.search, mode: 'insensitive' } },
        { action: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 5000 });
    return {
      title: 'Audit Trail Report',
      subtitle: `System activity · ${rows.length} event(s)`,
      meta: [{ label: 'Events', value: String(rows.length) }],
      headers: ['Time', 'Actor', 'Role', 'Action', 'Resource', 'Result', 'IP'],
      rows: rows.map((a: any) => [
        dt(a.createdAt),
        a.actorName ?? a.actorEmail ?? 'System',
        a.actorRole ?? '—',
        a.action,
        a.resource ?? '—',
        a.success ? 'success' : 'failed',
        a.ip ?? '—',
      ]),
      numericCols: [],
    };
  }

  // ─── Dispatcher ────────────────────────────────────────
  // Server-side role/branch scoping so a secretary/rider token can never
  // export rows outside their branch (same rules as the POS list).
  private applyScope(kind: string, q: ReportQueryDto, user?: AuthUser): void {
    if (!user || PRIVILEGED_ROLES.has(user.role)) return;
    if (ADMIN_ONLY_KINDS.has(kind)) {
      throw new ForbiddenException(`${kind} exports are restricted to administrators`);
    }
    if (user.branchId) q.branchId = user.branchId;
    else q.branchId = '__no_branch__';
    // POS sales: staff default to their own sales only (mirrors listSales).
    if (kind === 'pos-sales' && q.mine !== 'false') q.staffId = user.id;
  }

  private async build(kind: string, q: ReportQueryDto): Promise<ReportDataset> {
    switch (kind) {
      case 'sales':
        return this.salesData(q);
      case 'gas-balance':
        return this.gasData(q);
      case 'attendance':
        return this.attendanceData(q);
      case 'payroll':
        return this.payrollData(q);
      case 'orders':
        return this.ordersData(q, false);
      case 'pos-sales':
        return this.ordersData(q, true);
      case 'customers':
        return this.customersData(q);
      case 'products':
        return this.productsData(q);
      case 'inventory':
        return this.inventoryData(q);
      case 'deliveries':
        return this.deliveriesData(q);
      case 'staff':
        return this.staffData(q);
      case 'branches':
        return this.branchesData(q);
      case 'announcements':
        return this.announcementsData(q);
      case 'messages':
        return this.messagesData(q);
      case 'audit':
        return this.auditData(q);
      default:
        return this.salesData(q);
    }
  }

  // ─── Branded single documents (per-order invoice, per-delivery manifest) ──
  private assertBranchAccess(user: AuthUser | undefined, branchId?: string | null) {
    if (!user || PRIVILEGED_ROLES.has(user.role)) return;
    if (!user.branchId || user.branchId !== branchId) {
      throw new ForbiddenException('This document belongs to another branch');
    }
  }

  private ngn(n: number): string {
    return `₦${money(n).toLocaleString('en-NG')}`;
  }

  async invoicePdf(id: string, res: Response, user?: AuthUser) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        branch: { select: { name: true, address: true, phone: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    this.assertBranchAccess(user, order.branchId);

    const lines = (order.items ?? []).map((it: any) => ({
      description: `${it.product?.name ?? 'Item'}${Number(it.sizeKg) ? ` (${Number(it.sizeKg)}kg)` : ''}`,
      qty: it.quantity,
      unitPrice: money(num(it.unitPrice)),
      total: money(num(it.totalPrice)),
    }));

    renderDocumentPdf(res, {
      docType: order.orderType === 'walk_in' ? 'SALES RECEIPT' : 'TAX INVOICE',
      title: `Invoice ${order.orderNumber}`,
      number: order.orderNumber,
      date: dt(order.createdAt),
      partyLabel: 'Billed To',
      party: {
        name: order.customer?.fullName ?? 'Walk-in Customer',
        phone: order.customer?.phone,
        email: order.customer?.email,
      },
      meta: [
        { label: 'Branch', value: order.branch?.name ?? '—' },
        { label: 'Status', value: ORDER_STATUS_TO_UI[order.status] ?? String(order.status) },
        { label: 'Payment', value: `${order.paymentStatus}${order.paymentMethod ? ` · ${order.paymentMethod}` : ''}` },
      ],
      lines,
      totals: [
        { label: 'Subtotal', value: this.ngn(num(order.subtotal)) },
        { label: 'Delivery Fee', value: this.ngn(num(order.deliveryFee)) },
        { label: 'Discount', value: `- ${this.ngn(num(order.discount))}` },
        { label: 'TOTAL', value: this.ngn(num(order.totalAmount)), strong: true },
      ],
      notes: order.notes,
    });
  }

  async manifestPdf(id: string, res: Response, user?: AuthUser) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            customer: { select: { fullName: true, phone: true } },
            items: { include: { product: { select: { name: true } } } },
          },
        },
        pickupBranch: { select: { name: true, address: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    this.assertBranchAccess(user, delivery.pickupBranchId);

    const rider = delivery.riderId
      ? await this.prisma.user.findUnique({
          where: { id: delivery.riderId },
          select: { fullName: true, phone: true },
        })
      : null;

    const lines = (delivery.order?.items ?? []).map((it: any) => ({
      description: `${it.product?.name ?? 'Item'}${Number(it.sizeKg) ? ` (${Number(it.sizeKg)}kg)` : ''}`,
      qty: it.quantity,
      unitPrice: 0,
      total: 0,
    }));

    renderDocumentPdf(res, {
      docType: 'DELIVERY MANIFEST',
      title: `Manifest ${delivery.order?.orderNumber ?? delivery.id.slice(0, 8)}`,
      number: delivery.order?.orderNumber ?? String(delivery.id).slice(0, 8).toUpperCase(),
      date: dt(delivery.createdAt),
      partyLabel: 'Deliver To',
      party: {
        name: delivery.order?.customer?.fullName ?? 'Customer',
        phone: delivery.order?.customer?.phone,
        address: delivery.deliveryAddress,
      },
      meta: [
        { label: 'Pickup Branch', value: delivery.pickupBranch?.name ?? '—' },
        { label: 'Rider', value: rider?.fullName ?? 'Unassigned' },
        { label: 'Rider Phone', value: rider?.phone ?? '—' },
        { label: 'Status', value: DELIVERY_STATUS_TO_UI[delivery.status] ?? String(delivery.status) },
      ],
      lines,
      totals: [{ label: 'Packages', value: String(lines.length), strong: true }],
      notes: delivery.notes ?? delivery.riderNote,
    });
  }

  // JSON dataset (used by the Reports page live preview).
  async preview(kind: string, q: ReportQueryDto, user?: AuthUser): Promise<ReportDataset> {
    this.applyScope(kind, q, user);
    return this.build(kind, q);
  }

  async export(kind: string, q: ReportQueryDto, res: Response, user?: AuthUser) {
    this.applyScope(kind, q, user);
    const data = await this.build(kind, q);
    switch (q.format) {
      case 'csv':
        return renderCsv(res, data);
      case 'xlsx':
        return renderXlsx(res, data);
      case 'docx':
        return renderDocx(res, data);
      case 'pdf':
        return renderPdf(res, data);
      default:
        return renderCsv(res, data);
    }
  }
}
