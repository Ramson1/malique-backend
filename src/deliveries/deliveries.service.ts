import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { AssignRiderDto } from './dto/assign-rider.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PushService } from '../push/push.service';

const RIDER_ACTIVE_STATUSES = ['assigned', 'picked_up', 'in_transit'];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  async findAll(pagination: PaginationDto, branchId?: string, riderId?: string, status?: string) {
    const where: any = {};
    if (branchId) where.pickupBranchId = branchId;
    if (riderId) where.riderId = riderId;
    if (status) where.status = status;

    const [deliveries, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              items: { include: { product: true } },
              customer: { select: { id: true, fullName: true, phone: true, address: true } },
            },
          },
          pickupBranch: { select: { id: true, name: true, address: true } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return {
      data: deliveries,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async findOne(id: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            customer: { select: { id: true, fullName: true, phone: true, address: true } },
          },
        },
        pickupBranch: true,
      },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    return delivery;
  }

  async assignRider(id: string, dto: AssignRiderDto) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    // Verify the rider exists and is active
    const rider = await this.prisma.user.findFirst({
      where: { id: dto.riderId, role: 'rider', status: 'active' },
    });

    if (!rider) {
      throw new BadRequestException('Rider not found or not active');
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: { riderId: dto.riderId, status: 'assigned' },
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            customer: { select: { id: true, fullName: true, phone: true, address: true } },
          },
        },
        pickupBranch: { select: { id: true, name: true, address: true } },
      },
    });

    // Instant dispatch alert (fire-and-forget, never fails the request).
    void this.push.notifyRidersAssigned(dto.riderId, {
      orderNumber: updated.order?.orderNumber,
      address: updated.deliveryAddress,
    });

    return updated;
  }

  // Today's snapshot for the rider home screen.
  async todayStats(userId: string) {
    const from = startOfToday();
    const [assignedRows, completedToday] = await Promise.all([
      this.prisma.delivery.findMany({
        where: { riderId: userId, createdAt: { gte: from } },
        select: { id: true, status: true, deliveryFee: true, deliveredAt: true },
      }),
      this.prisma.delivery.count({
        where: { riderId: userId, status: 'delivered', deliveredAt: { gte: from } },
      }),
    ]);

    const pendingToday = assignedRows.filter((d: any) =>
      RIDER_ACTIVE_STATUSES.includes(d.status),
    ).length;
    const todayEarnings = assignedRows
      .filter((d: any) => d.status === 'delivered' && d.deliveredAt)
      .reduce((sum: number, d: any) => sum + Number(d.deliveryFee || 0), 0);

    return {
      todayDeliveries: assignedRows.length,
      completedToday,
      pendingToday,
      todayEarnings: Math.round(todayEarnings * 100) / 100,
    };
  }

  // Delivery-fee earnings: today / this week / this month + recent entries.
  async earnings(userId: string) {
    const now = new Date();
    const startToday = startOfToday();
    const startWeek = new Date(startToday);
    startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const rows = await this.prisma.delivery.findMany({
      where: { riderId: userId, status: 'delivered', deliveredAt: { gte: startMonth } },
      include: {
        order: { select: { orderNumber: true, customer: { select: { fullName: true } } } },
        pickupBranch: { select: { name: true } },
      },
      orderBy: { deliveredAt: 'desc' },
      take: 200,
    });

    const sumFrom = (list: any[]) =>
      Math.round(list.reduce((s, d) => s + Number(d.deliveryFee || 0), 0) * 100) / 100;

    const todayRows = rows.filter((d: any) => d.deliveredAt >= startToday);
    const weekRows = rows.filter((d: any) => d.deliveredAt >= startWeek);

    return {
      summary: {
        today: sumFrom(todayRows),
        thisWeek: sumFrom(weekRows),
        thisMonth: sumFrom(rows),
      },
      entries: rows.map((d: any) => ({
        id: d.id,
        deliveryId: d.id,
        orderNumber: d.order?.orderNumber ?? '—',
        customerName: d.order?.customer?.fullName ?? '—',
        branchName: d.pickupBranch?.name ?? '—',
        deliveryFee: Number(d.deliveryFee || 0),
        deliveredAt: d.deliveredAt ? new Date(d.deliveredAt).toISOString() : null,
      })),
    };
  }

  async updateStatus(id: string, dto: UpdateDeliveryStatusDto, userId: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
    });

    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }

    if (delivery.riderId !== userId) {
      throw new ForbiddenException('You can only update your own deliveries');
    }

    const updateData: any = { status: dto.status as any };

    if (dto.riderNote) updateData.riderNote = dto.riderNote;
    if (dto.failureReason) updateData.failureReason = dto.failureReason;

    // Handover verification: nobody closes a delivery without saying how the
    // money was collected — unless the customer already paid online.
    const order = await this.prisma.order.findUnique({
      where: { id: delivery.orderId },
      select: {
        orderNumber: true,
        totalAmount: true,
        paymentStatus: true,
        paymentMethod: true,
      },
    });
    const settledOnline = order?.paymentStatus === 'paid';

    if (dto.status === 'picked_up') {
      updateData.pickupTime = new Date();
    }

    if (dto.status === 'delivered') {
      if (!dto.paymentMethod && !settledOnline) {
        throw new BadRequestException(
          'Log the collected payment method before closing a delivery',
        );
      }
      updateData.deliveredAt = new Date();
      // Calculate actual delivery time
      if (delivery.pickupTime) {
        const diff = Date.now() - delivery.pickupTime.getTime();
        updateData.actualTime = Math.round(diff / 60000); // minutes
      }
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: updateData,
      include: {
        order: {
          include: {
            items: { include: { product: true } },
            customer: { select: { id: true, fullName: true, phone: true } },
          },
        },
      },
    });

    // Keep the linked order's lifecycle in sync so the admin Orders page and
    // analytics always reflect what the rider just did (never downgrade a
    // cancelled or already-delivered order).
    const orderSync: Record<string, string> = {
      picked_up: 'out_for_delivery',
      in_transit: 'out_for_delivery',
      delivered: 'delivered',
    };
    const nextOrderStatus = orderSync[dto.status as string];
    if (nextOrderStatus && updated.order && updated.order.status !== 'cancelled' && updated.order.status !== 'delivered') {
      await this.prisma.order
        .update({ where: { id: updated.orderId }, data: { status: nextOrderStatus as any } })
        .catch(() => undefined);
    }

    // Cash / POS / transfer collected at the door is recorded as a pending
    // payment; the order only flips to paid when the front desk confirms it
    // (POST /payments/:orderId/confirm).
    if (dto.status === 'delivered' && !settledOnline && dto.paymentMethod) {
      const raw = dto.amountCollected;
      const amount =
        raw !== undefined && raw !== null && String(raw).trim() !== ''
          ? Number(raw)
          : Number(order?.totalAmount ?? 0);
      await this.prisma.payment
        .create({
          data: {
            orderId: delivery.orderId,
            amount: Number.isFinite(amount) ? amount : 0,
            paymentMethod: dto.paymentMethod as any,
            transactionRef:
              dto.paymentReference?.trim() ||
              `POD-${order?.orderNumber ?? delivery.id}-${randomBytes(3).toString('hex').toUpperCase()}`,
            gateway: 'manual',
            status: 'pending',
            metadata: {
              collectedBy: userId,
              note: dto.riderNote ?? null,
            } as any,
          },
        })
        .catch(() => undefined);
    }

    return updated;
  }
}
