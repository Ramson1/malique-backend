import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { ScheduleDeliveryDto } from './dto/dispatch.dto';

const ACTIVE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

function money(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  private mapCard(d: any, riderNames: Record<string, string> = {}) {
    return {
      id: d.id,
      orderId: d.orderId,
      orderNumber: d.order?.orderNumber ?? '—',
      status: d.status,
      priority: d.priority,
      riderId: d.riderId,
      riderName: riderNames[d.riderId] ?? '—',
      customerName: d.order?.customer?.fullName ?? '—',
      customerPhone: d.order?.customer?.phone ?? '',
      address: d.deliveryAddress,
      branchName: d.pickupBranch?.name ?? '—',
      total: money(d.order?.totalAmount),
      scheduledAt: d.scheduledAt ? new Date(d.scheduledAt).toISOString() : null,
      windowLabel: d.windowLabel ?? null,
      dispatchedAt: d.dispatchedAt ? new Date(d.dispatchedAt).toISOString() : null,
      deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : null,
      notes: d.notes ?? null,
      createdAt: d.createdAt,
    };
  }

  // Delivery has no Prisma relation for riderId (plain column on the shared
  // schema), so rider names are resolved with a separate lookup.
  private include() {
    return {
      order: {
        select: {
          orderNumber: true,
          totalAmount: true,
          customer: { select: { fullName: true, phone: true } },
        },
      },
      pickupBranch: { select: { name: true } },
    };
  }

  private async riderNames(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!unique.length) return {} as Record<string, string>;
    const rows = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return rows.reduce<Record<string, string>>((acc, r: any) => {
      acc[r.id] = r.fullName;
      return acc;
    }, {});
  }

  // Dispatch board payload: four status columns + per-rider active load.
  async board(branchId?: string) {
    const where: any = {};
    if (branchId) where.pickupBranchId = branchId;

    const [deliveries, riders] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: this.include(),
        orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
        take: 1000,
      }),
      this.prisma.user.findMany({
        where: { role: 'rider', status: 'active', ...(branchId ? { branchId } : {}) },
        select: { id: true, fullName: true, phone: true },
        orderBy: { fullName: 'asc' },
      }),
    ]);

    const names = await this.riderNames(deliveries.map((d: any) => d.riderId));
    const cards = deliveries.map((d: any) => this.mapCard(d, names));
    const by = (...statuses: string[]) => cards.filter((c) => statuses.includes(c.status));

    // Active load per rider (assigned / picked_up / in_transit).
    const loadWhere: any = { status: { in: ACTIVE_STATUSES } };
    if (branchId) loadWhere.pickupBranchId = branchId;
    const loadGroups = await this.prisma.delivery.groupBy({
      by: ['riderId'],
      where: loadWhere,
      _count: { _all: true },
    });
    const loadMap: Record<string, number> = {};
    for (const g of loadGroups as any[]) loadMap[g.riderId] = g._count._all;

    return {
      columns: {
        awaiting: by('assigned'),
        onTheRoad: by('picked_up', 'in_transit'),
        delivered: by('delivered'),
        issues: by('failed', 'returned'),
      },
      riders: riders.map((r: any) => ({ ...r, activeLoad: loadMap[r.id] ?? 0 })),
    };
  }

  async schedule(id: string, dto: ScheduleDeliveryDto) {
    const data: any = {};
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    }
    if (dto.windowLabel !== undefined) data.windowLabel = dto.windowLabel || null;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.notes !== undefined) data.notes = dto.notes || null;

    const updated = await this.prisma.delivery.update({
      where: { id },
      data,
      include: this.include(),
    });
    return this.mapCard(updated, await this.riderNames([updated.riderId]));
  }

  // Mark a delivery as dispatched (on the road). Records dispatchedAt.
  async markDispatched(id: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Delivery not found');
    if (d.status === 'delivered') {
      throw new BadRequestException('Delivery is already completed');
    }
    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { status: 'in_transit', dispatchedAt: d.dispatchedAt ?? new Date() },
      include: this.include(),
    });
    return this.mapCard(updated, await this.riderNames([updated.riderId]));
  }

  async reassign(id: string, riderId: string) {
    const rider = await this.prisma.user.findFirst({
      where: { id: riderId, role: 'rider', status: 'active' },
    });
    if (!rider) throw new BadRequestException('Rider not found or not active');
    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { riderId, status: 'assigned' },
      include: this.include(),
    });
    // The moment a job is (re)assigned, ping the rider's devices.
    void this.push.notifyRidersAssigned(riderId, {
      orderNumber: updated.order?.orderNumber,
      address: updated.deliveryAddress,
    });
    return this.mapCard(updated, await this.riderNames([updated.riderId]));
  }

  // Board drag-and-drop status change, keeping the timestamp columns in sync.
  async setBoardStatus(id: string, status: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Delivery not found');
    const data: any = { status: status as any };
    if (status === 'picked_up' || status === 'in_transit') {
      data.dispatchedAt = d.dispatchedAt ?? new Date();
    }
    if (status === 'delivered') {
      data.dispatchedAt = d.dispatchedAt ?? new Date();
      data.deliveredAt = d.deliveredAt ?? new Date();
      if (d.pickupTime) data.actualTime = Math.round((Date.now() - d.pickupTime.getTime()) / 60000);
    }
    const updated = await this.prisma.delivery.update({
      where: { id },
      data,
      include: this.include(),
    });
    return this.mapCard(updated, await this.riderNames([updated.riderId]));
  }
}
