import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddPayrollEntryDto,
  GeneratePayrollDto,
  ListPayrollQueryDto,
  SetPayrollStatusDto,
} from './dto/payroll.dto';

// Types that increase take-home vs those that reduce it. A line item is always
// stored as a positive amount; its sign is implied by `type` so history stays
// immutable and re-computable.
const EARNINGS = new Set(['basic', 'allowance', 'overtime', 'bonus', 'increment']);
const NEGATIVE = new Set(['deduction', 'penalty']);

// Prisma Decimal -> plain number, defensively.
function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const anyv = v as any;
  if (typeof anyv.toNumber === 'function') return anyv.toNumber();
  const n = Number(anyv);
  return Number.isFinite(n) ? n : 0;
}

// "YYYY-MM-DD" -> UTC-midnight Date for a @db.Date column.
function dayStart(yyyymmdd: string): Date {
  return new Date(`${yyyymmdd}T00:00:00.000Z`);
}

function startOfMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

interface Actor {
  id: string;
  role: string;
  branchId?: string | null;
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  // Roll the auditable entries up into the Payroll aggregate columns and
  // return the recomputed summary. Keeps both representations consistent.
  private async recompute(payrollId: string) {
    const entries = await this.prisma.payrollEntry.findMany({
      where: { payrollId },
    });
    const sums: Record<string, number> = {};
    for (const e of entries) {
      sums[e.type] = (sums[e.type] ?? 0) + toNum(e.amount);
    }
    const basic = (sums.basic ?? 0) + (sums.increment ?? 0);
    const allowances = sums.allowance ?? 0;
    const overtimePay = sums.overtime ?? 0;
    const bonus = sums.bonus ?? 0;
    const deductions = (sums.deduction ?? 0) + (sums.penalty ?? 0);
    const gross = basic + allowances + overtimePay + bonus;
    const net = gross - deductions;

    await this.prisma.payroll.update({
      where: { id: payrollId },
      data: {
        basicSalary: new Prisma.Decimal(basic.toFixed(2)),
        allowances: new Prisma.Decimal(allowances.toFixed(2)),
        overtimePay: new Prisma.Decimal(overtimePay.toFixed(2)),
        bonus: new Prisma.Decimal(bonus.toFixed(2)),
        deductions: new Prisma.Decimal(deductions.toFixed(2)),
      },
    });
    return { basic, allowances, overtimePay, bonus, deductions, gross, net };
  }

  private mapEntry(e: any) {
    return {
      id: e.id,
      type: e.type,
      amount: toNum(e.amount),
      reason: e.reason ?? undefined,
      sign: NEGATIVE.has(e.type) ? -1 : 1,
      createdAt: e.createdAt,
    };
  }

  // Period list of payslips (aggregate + live totals from entries).
  async listPayroll(query: ListPayrollQueryDto) {
    const period = query.period ?? startOfMonth(new Date());
    const where: any = { period: dayStart(period) };
    if (query.branchId) where.branchId = query.branchId;

    const rows = await this.prisma.payroll.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, jobTitle: true, email: true, baseSalary: true } },
        branch: { select: { id: true, name: true } },
        entries: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { user: { fullName: 'asc' } },
    });

    const payslips = rows.map((p: any) => {
      const earnings = p.entries
        .filter((e: any) => EARNINGS.has(e.type))
        .reduce((s: number, e: any) => s + toNum(e.amount), 0);
      const deductions = p.entries
        .filter((e: any) => NEGATIVE.has(e.type))
        .reduce((s: number, e: any) => s + toNum(e.amount), 0);
      return {
        id: p.id,
        userId: p.userId,
        staffName: p.user?.fullName ?? '—',
        jobTitle: p.user?.jobTitle ?? undefined,
        email: p.user?.email ?? undefined,
        branchId: p.branchId,
        branchName: p.branch?.name ?? '—',
        period: p.period.toISOString().slice(0, 10),
        status: p.status,
        basicSalary: toNum(p.basicSalary),
        allowances: toNum(p.allowances),
        overtimePay: toNum(p.overtimePay),
        bonus: toNum(p.bonus),
        deductions: toNum(p.deductions),
        earnings,
        net: earnings - deductions,
        entries: p.entries.map((e: any) => this.mapEntry(e)),
      };
    });

    const totals = payslips.reduce(
      (acc, p) => {
        acc.gross += p.earnings;
        acc.deductions += p.deductions;
        acc.net += p.net;
        acc.count += 1;
        return acc;
      },
      { gross: 0, deductions: 0, net: 0, count: 0 },
    );

    return { period, payslips, totals };
  }

  // Draft payslips for every active, branched staff member with a base salary.
  async generate(dto: GeneratePayrollDto, actor: Actor) {
    const period = dayStart(dto.period);
    const staffWhere: any = {
      status: 'active',
      role: { in: ['admin', 'branch_manager', 'staff'] },
      branchId: dto.branchId ? dto.branchId : { not: null },
    };
    const staff = await this.prisma.user.findMany({ where: staffWhere });

    let created = 0;
    let skipped = 0;
    for (const u of staff) {
      if (!u.branchId) {
        skipped++;
        continue;
      }
      const existing = await this.prisma.payroll.findUnique({
        where: { userId_period: { userId: u.id, period } },
      });
      if (existing) {
        skipped++;
        continue;
      }
      const basicAmount = toNum(u.baseSalary);
      const payroll = await this.prisma.payroll.create({
        data: {
          userId: u.id,
          branchId: u.branchId,
          period,
          basicSalary: new Prisma.Decimal(basicAmount.toFixed(2)),
        },
      });
      // Seed the auditable basic line so the payslip total reconciles.
      await this.prisma.payrollEntry.create({
        data: {
          payrollId: payroll.id,
          userId: u.id,
          period,
          type: 'basic',
          amount: new Prisma.Decimal(basicAmount.toFixed(2)),
          reason: 'Monthly base salary',
          approvedById: actor?.id ?? null,
        },
      });
      created++;
    }

    return { period: dto.period, created, skipped };
  }

  // Ensure a Payroll row exists for (userId, period); create it if missing.
  private async ensurePayroll(userId: string, periodDate: Date) {
    const existing = await this.prisma.payroll.findUnique({
      where: { userId_period: { userId, period: periodDate } },
    });
    if (existing) return existing;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Staff member not found');
    if (!user.branchId) throw new BadRequestException('Staff member has no branch');
    const basicAmount = toNum(user.baseSalary);
    const payroll = await this.prisma.payroll.create({
      data: {
        userId,
        branchId: user.branchId,
        period: periodDate,
        basicSalary: new Prisma.Decimal(basicAmount.toFixed(2)),
      },
    });
    await this.prisma.payrollEntry.create({
      data: {
        payrollId: payroll.id,
        userId,
        period: periodDate,
        type: 'basic',
        amount: new Prisma.Decimal(basicAmount.toFixed(2)),
        reason: 'Monthly base salary',
      },
    });
    return payroll;
  }

  async addEntry(dto: AddPayrollEntryDto, actor: Actor) {
    const periodDate = dayStart(dto.period);
    const payroll = await this.ensurePayroll(dto.userId, periodDate);
    if (payroll.status === 'paid') {
      throw new BadRequestException('This payslip is already paid and can no longer be edited');
    }
    const entry = await this.prisma.payrollEntry.create({
      data: {
        payrollId: payroll.id,
        userId: dto.userId,
        period: periodDate,
        type: dto.type,
        amount: new Prisma.Decimal(Number(dto.amount).toFixed(2)),
        reason: dto.reason ?? null,
        approvedById: actor?.id ?? null,
      },
    });
    const summary = await this.recompute(payroll.id);
    return { entry: this.mapEntry(entry), summary };
  }

  async removeEntry(entryId: string) {
    const entry = await this.prisma.payrollEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.type === 'basic') {
      throw new BadRequestException('The base salary line cannot be removed');
    }
    const payroll = await this.prisma.payroll.findUnique({
      where: { id: entry.payrollId ?? undefined },
    });
    if (payroll?.status === 'paid') {
      throw new BadRequestException('This payslip is already paid and can no longer be edited');
    }
    await this.prisma.payrollEntry.delete({ where: { id: entryId } });
    const summary = entry.payrollId ? await this.recompute(entry.payrollId) : null;
    return { deleted: true, summary };
  }

  async setStatus(id: string, dto: SetPayrollStatusDto, actor: Actor) {
    const payroll = await this.prisma.payroll.findUnique({ where: { id } });
    if (!payroll) throw new NotFoundException('Payslip not found');
    const data: any = { status: dto.status };
    if (dto.status === 'approved') data.approvedBy = actor?.id ?? payroll.approvedBy;
    if (dto.status === 'paid') data.paidAt = new Date();
    if (dto.status === 'draft') {
      data.paidAt = null;
      data.approvedBy = null;
    }
    const updated = await this.prisma.payroll.update({
      where: { id },
      data,
      include: { entries: { orderBy: { createdAt: 'asc' } } },
    });
    return { id: updated.id, status: updated.status };
  }

  // Single-payslip detail (used by the payslip view / PDF export later).
  async payslip(userId: string, period: string) {
    const p = await this.prisma.payroll.findUnique({
      where: { userId_period: { userId, period: dayStart(period) } },
      include: {
        user: { select: { fullName: true, jobTitle: true, email: true, staffCode: true, baseSalary: true } },
        branch: { select: { name: true, address: true } },
        entries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!p) throw new NotFoundException('No payslip for this staff / period');
    return {
      id: p.id,
      staffName: p.user?.fullName,
      jobTitle: p.user?.jobTitle,
      staffCode: p.user?.staffCode,
      branchName: p.branch?.name,
      period: p.period.toISOString().slice(0, 10),
      status: p.status,
      entries: p.entries.map((e: any) => this.mapEntry(e)),
    };
  }
}
