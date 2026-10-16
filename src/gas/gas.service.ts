import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { litresToKg, classifyVariance } from './lpg.util';
import {
  CreateGasPurchaseDto,
  CreateTankReadingDto,
  CreateCylinderFillDto,
  GasBalanceQueryDto,
} from './dto/gas.dto';

// Coerce a Prisma Decimal | number | null into a plain JS number safely.
function toNum(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class GasService {
  constructor(private readonly prisma: PrismaService) {}

  private period(query: GasBalanceQueryDto) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = query.to ? new Date(query.to) : now;
    // Make `to` inclusive of the whole final day.
    if (query.to) to.setHours(23, 59, 59, 999);
    return { from, to };
  }

  private round(n: number, dp = 3): number {
    const f = 10 ** dp;
    return Math.round(n * f) / f;
  }

  // ─── Lookups for the ledger entry forms ────────────────
  async listCylinders(branchId?: string) {
    const rows = await this.prisma.cylinder.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { serialNumber: 'asc' },
      take: 500,
      select: { id: true, serialNumber: true, sizeKg: true, status: true },
    });
    return {
      cylinders: rows.map((c: any) => ({
        id: c.id,
        serialNumber: c.serialNumber,
        sizeKg: toNum(c.sizeKg),
        status: c.status,
      })),
    };
  }

  async listTanks(branchId?: string) {
    const rows = await this.prisma.bulkStorage.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { tankName: 'asc' },
      select: { id: true, tankName: true, capacityLiters: true, currentVolumeL: true },
    });
    return {
      tanks: rows.map((t: any) => ({
        id: t.id,
        tankName: t.tankName,
        capacityLiters: toNum(t.capacityLiters),
        currentVolumeL: toNum(t.currentVolumeL),
      })),
    };
  }

  // ─── Purchases (stock-in) ──────────────────────────────
  async listPurchases(branchId?: string) {
    const rows = await this.prisma.gasPurchase.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { purchaseDate: 'desc' },
      include: { branch: { select: { name: true } } },
    });
    return {
      purchases: rows.map((p: any) => ({
        id: p.id,
        branchId: p.branchId,
        branchName: p.branch?.name ?? '—',
        supplierName: p.supplierName,
        purchaseDate: p.purchaseDate.toISOString(),
        volumeKg: toNum(p.volumeKg),
        unitCost: toNum(p.unitCost),
        totalCost: toNum(p.totalCost),
        documentUrl: p.documentUrl ?? undefined,
        notes: p.notes ?? undefined,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async createPurchase(dto: CreateGasPurchaseDto, actor: any) {
    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Branch not found');

    const unitCost = toNum(dto.unitCost);
    const totalCost =
      dto.totalCost != null ? toNum(dto.totalCost) : this.round(unitCost * dto.volumeKg, 2);

    const created = await this.prisma.gasPurchase.create({
      data: {
        branchId: dto.branchId,
        supplierName: dto.supplierName,
        purchaseDate: new Date(dto.purchaseDate),
        volumeKg: dto.volumeKg,
        unitCost,
        totalCost,
        documentUrl: dto.documentUrl ?? null,
        notes: dto.notes ?? null,
        recordedById: actor?.id ?? null,
      },
      include: { branch: { select: { name: true } } },
    });
    return { id: created.id, volumeKg: toNum(created.volumeKg), branchName: created.branch?.name };
  }

  // ─── Tank readings (bulk gauge, in litres) ─────────────
  async listReadings(branchId?: string) {
    const rows = await this.prisma.tankReading.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { readAt: 'desc' },
      take: 200,
      include: {
        branch: { select: { name: true } },
        bulkStorage: { select: { tankName: true } },
      },
    });
    return {
      readings: rows.map((r: any) => ({
        id: r.id,
        branchId: r.branchId,
        branchName: r.branch?.name ?? '—',
        tankName: r.bulkStorage?.tankName ?? 'Main tank',
        readAt: r.readAt.toISOString(),
        volumeLiters: toNum(r.volumeLiters),
        volumeKg: this.round(litresToKg(toNum(r.volumeLiters)), 2),
        note: r.note ?? undefined,
      })),
    };
  }

  async createReading(dto: CreateTankReadingDto, actor: any) {
    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Branch not found');

    const created = await this.prisma.tankReading.create({
      data: {
        branchId: dto.branchId,
        bulkStorageId: dto.bulkStorageId ?? null,
        readAt: new Date(dto.readAt),
        volumeLiters: dto.volumeLiters,
        measuredById: actor?.id ?? null,
        note: dto.note ?? null,
      },
    });

    // Keep the mutable tank snapshot in sync when a specific tank is read.
    if (dto.bulkStorageId) {
      await this.prisma.bulkStorage.update({
        where: { id: dto.bulkStorageId },
        data: {
          currentVolumeL: dto.volumeLiters,
          lastMeasurementAt: new Date(dto.readAt),
          measuredBy: actor?.id ?? null,
        },
      });
    }
    return { id: created.id, volumeLiters: toNum(created.volumeLiters) };
  }

  // ─── Cylinder fills (dispensed, in kg) ─────────────────
  async listFills(branchId?: string) {
    const rows = await this.prisma.cylinderFill.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { filledAt: 'desc' },
      take: 200,
      include: {
        branch: { select: { name: true } },
        cylinder: { select: { serialNumber: true, sizeKg: true } },
      },
    });
    return {
      fills: rows.map((f: any) => ({
        id: f.id,
        branchId: f.branchId,
        branchName: f.branch?.name ?? '—',
        cylinderSerial: f.cylinder?.serialNumber ?? '—',
        cylinderSizeKg: toNum(f.cylinder?.sizeKg),
        filledKg: toNum(f.filledKg),
        filledAt: f.filledAt.toISOString(),
      })),
    };
  }

  async createFill(dto: CreateCylinderFillDto, actor: any) {
    const cylinder = await this.prisma.cylinder.findUnique({ where: { id: dto.cylinderId } });
    if (!cylinder) throw new NotFoundException('Cylinder not found');

    const created = await this.prisma.cylinderFill.create({
      data: {
        cylinderId: dto.cylinderId,
        branchId: dto.branchId,
        filledKg: dto.filledKg,
        filledAt: new Date(dto.filledAt),
        filledById: actor?.id ?? null,
        fromReadingId: dto.fromReadingId ?? null,
      },
    });

    // Reflect the fill on the cylinder asset record.
    await this.prisma.cylinder.update({
      where: { id: dto.cylinderId },
      data: { status: 'filled', lastFilledAt: new Date(dto.filledAt) },
    });
    return { id: created.id, filledKg: toNum(created.filledKg) };
  }

  // ─── Balance engine (the "checkmate everything" maths) ─
  async balance(query: GasBalanceQueryDto) {
    const { from, to } = this.period(query);
    const branchId = query.branchId;
    const whereBranch = branchId ? { branchId } : {};

    const [openingReading, purchaseAgg, fillAgg, closingReading, currentReading] =
      await Promise.all([
        // Latest reading BEFORE the window = opening stock.
        this.prisma.tankReading.findFirst({
          where: { ...whereBranch, readAt: { lt: from } },
          orderBy: { readAt: 'desc' },
        }),
        this.prisma.gasPurchase.aggregate({
          _sum: { volumeKg: true },
          where: { ...whereBranch, purchaseDate: { gte: from, lte: to } },
        }),
        this.prisma.cylinderFill.aggregate({
          _sum: { filledKg: true },
          where: { ...whereBranch, filledAt: { gte: from, lte: to } },
        }),
        // Latest reading within/at the end of the window = actual closing.
        this.prisma.tankReading.findFirst({
          where: { ...whereBranch, readAt: { lte: to } },
          orderBy: { readAt: 'desc' },
        }),
        // Most recent reading overall = current on-hand (for the live tile).
        this.prisma.tankReading.findFirst({
          where: whereBranch,
          orderBy: { readAt: 'desc' },
        }),
      ]);

    const openingKg = litresToKg(toNum(openingReading?.volumeLiters));
    const purchasesKg = toNum(purchaseAgg._sum.volumeKg);
    const dispensedKg = toNum(fillAgg._sum.filledKg);
    const expectedClosingKg = openingKg + purchasesKg - dispensedKg;

    const hasActual = !!closingReading;
    const actualClosingKg = hasActual ? litresToKg(toNum(closingReading!.volumeLiters)) : 0;
    const varianceKg = hasActual ? actualClosingKg - expectedClosingKg : 0;
    const variancePct =
      expectedClosingKg > 0 ? varianceKg / expectedClosingKg : 0;
    const status = classifyVariance(variancePct);

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      branchId: branchId ?? null,
      openingKg: this.round(openingKg, 2),
      purchasesKg: this.round(purchasesKg, 2),
      dispensedKg: this.round(dispensedKg, 2),
      expectedClosingKg: this.round(expectedClosingKg, 2),
      actualClosingKg: this.round(actualClosingKg, 2),
      hasActual,
      varianceKg: this.round(varianceKg, 2),
      variancePct: this.round(variancePct * 100, 2),
      status,
      shrinkageKg: this.round(varianceKg < 0 ? -varianceKg : 0, 2),
      currentOnHandKg: this.round(litresToKg(toNum(currentReading?.volumeLiters)), 2),
    };
  }

  // ─── Reconciliation snapshots ──────────────────────────
  async reconcile(query: GasBalanceQueryDto, actor: any) {
    const b = await this.balance(query);
    if (!b.branchId) throw new NotFoundException('A specific branch is required to reconcile');
    if (!b.hasActual) throw new NotFoundException('No tank reading available to reconcile against');

    const stored = await this.prisma.gasReconciliation.create({
      data: {
        branchId: b.branchId,
        periodStart: new Date(b.period.from),
        periodEnd: new Date(b.period.to),
        openingKg: b.openingKg,
        purchasesKg: b.purchasesKg,
        dispensedKg: b.dispensedKg,
        expectedKg: b.expectedClosingKg,
        closingKg: b.actualClosingKg,
        varianceKg: b.varianceKg,
        variancePct: this.round(b.variancePct / 100, 4),
        status: b.status as any,
      },
      include: { branch: { select: { name: true } } },
    });
    return {
      id: stored.id,
      branchName: (stored as any).branch?.name,
      status: stored.status,
      varianceKg: toNum(stored.varianceKg),
      createdAt: stored.createdAt.toISOString(),
    };
  }

  async listReconciliations(branchId?: string) {
    const rows = await this.prisma.gasReconciliation.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { branch: { select: { name: true } } },
    });
    return {
      reconciliations: rows.map((r: any) => ({
        id: r.id,
        branchName: r.branch?.name ?? '—',
        periodStart: r.periodStart.toISOString(),
        periodEnd: r.periodEnd.toISOString(),
        openingKg: toNum(r.openingKg),
        purchasesKg: toNum(r.purchasesKg),
        dispensedKg: toNum(r.dispensedKg),
        expectedKg: toNum(r.expectedKg),
        closingKg: toNum(r.closingKg),
        varianceKg: toNum(r.varianceKg),
        variancePct: this.round(toNum(r.variancePct) * 100, 2),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
