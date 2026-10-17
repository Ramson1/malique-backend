import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { MailService } from '../mail/mail.service';
import { PushService } from '../push/push.service';
import { generateOrderNumber } from './order-number.util';
import { resolveUnitPrice } from '../products/price.util';
import { computeDeliveryFee } from './geo.util';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private push: PushService,
  ) {}

  async create(dto: CreateOrderDto, customerId: string) {
    const orderNumber = await generateOrderNumber(this.prisma);

    // Server-authoritative pricing: resolve every line against the live
    // catalog (branch ProductPrice override, else per-kg scaling of
    // basePrice, else flat basePrice). Client unitPrice is only trusted for
    // legacy custom lines whose productId does not resolve to a product.
    const productIds = Array.from(new Set(dto.items.map((i) => i.productId)));
    const [products, branch] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } } }),
      this.prisma.branch.findUnique({ where: { id: dto.branchId } }),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const priceRows = products.length
      ? await this.prisma.productPrice.findMany({
          where: { branchId: dto.branchId, productId: { in: productIds } },
        })
      : [];

    let subtotal = 0;
    const orderItems = dto.items.map((item) => {
      const product = productById.get(item.productId);
      const unitPrice = product
        ? resolveUnitPrice(product, priceRows.filter((p) => p.productId === item.productId), item.sizeKg)
        : item.unitPrice;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;
      return {
        productId: item.productId,
        sizeKg: item.sizeKg,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        isRefill: item.isRefill || false,
        cylinderSerial: item.cylinderSerial,
      };
    });

    // Zone delivery fee is computed from the branch coordinates and the
    // dropped pin — never taken from the request body.
    const deliveryFee = dto.deliveryAddress
      ? computeDeliveryFee(branch, dto.deliveryLat, dto.deliveryLng)
      : 0;
    const discount = dto.discount || 0;
    const totalAmount = subtotal + deliveryFee - discount;

    // Keep the drop-off contact visible to dispatch without a schema change.
    const notes =
      [
        dto.notes,
        dto.deliveryPhone ? `Drop-off contact: ${dto.deliveryPhone}` : null,
      ]
        .filter(Boolean)
        .join(' | ') || null;

    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        customerId,
        branchId: dto.branchId,
        orderType: (dto.orderType as any) || 'online',
        subtotal,
        deliveryFee,
        discount,
        totalAmount,
        paymentMethod: (dto.paymentMethod as any) || null,
        notes,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: { include: { product: true } },
        customer: true,
        branch: true,
      },
    });

    // Create delivery if delivery address is provided
    if (dto.deliveryAddress) {
      // Find an available rider for the branch
      const rider = await this.prisma.user.findFirst({
        where: { branchId: dto.branchId, role: 'rider', status: 'active' },
      });

      if (rider) {
        await this.prisma.delivery.create({
          data: {
            orderId: order.id,
            riderId: rider.id,
            pickupBranchId: dto.branchId,
            deliveryAddress: dto.deliveryAddress,
            deliveryLat: dto.deliveryLat,
            deliveryLng: dto.deliveryLng,
            deliveryFee,
          },
        });
        // Auto-assigned at checkout — alert the rider immediately.
        void this.push.notifyRidersAssigned(rider.id, {
          orderNumber: order.orderNumber,
          address: dto.deliveryAddress,
        });
      }
    }

    // Update customer stats
    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        orderCount: { increment: 1 },
        totalSpent: { increment: totalAmount },
      },
    });

    // Send order confirmation email
    try {
      await this.mailService.sendOrderConfirmation(
        order.customer.email,
        order.customer.fullName,
        order.orderNumber,
        totalAmount,
      );
    } catch (error) {
      // Don't fail the order if email fails
      console.error('Failed to send order confirmation email:', error);
    }

    // Alert the official company inbox about the new web order (fire-and-forget).
    this.mailService.notifyOffice('New Website Order', {
      'Order Number': order.orderNumber,
      Customer: order.customer.fullName,
      Phone: order.customer.phone,
      Email: order.customer.email,
      Branch: order.branch?.name,
      Items: order.items
        .map((it: any) => `${it.quantity} × ${it.product?.name ?? 'Item'} (${it.sizeKg}kg)`)
        .join(', '),
      Total: `NGN ${Number(totalAmount).toLocaleString('en-NG')}`,
      Delivery: dto.deliveryAddress ?? 'Customer pickup',
    });

    return order;
  }

  async findAll(pagination: PaginationDto, customerId?: string, branchId?: string, status?: string) {
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { product: true } },
          customer: { select: { id: true, fullName: true, email: true, phone: true } },
          branch: { select: { id: true, name: true } },
          delivery: true,
          payments: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async findOne(id: string, user?: any) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        customer: { select: { id: true, fullName: true, email: true, phone: true, address: true } },
        branch: true,
        delivery: { include: { pickupBranch: true } },
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Customers may only see their own order — respond 404 (not 403) so the
    // existence of other orders is never leaked.
    if (user?.role === 'customer' && order.customerId !== user.id) {
      throw new NotFoundException('Order not found');
    }

    // Attach the assigned rider (no Prisma relation on Delivery.riderId) so
    // the website tracking page can show name/phone.
    if (order.delivery?.riderId) {
      const rider = await this.prisma.user.findUnique({
        where: { id: order.delivery.riderId },
        select: { id: true, fullName: true, phone: true },
      });
      (order.delivery as any).rider = rider;
    }

    return order;
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const updateData: any = { status: dto.status as any };

    if (dto.status === 'cancelled') {
      updateData.cancelledAt = new Date();
      updateData.cancelReason = dto.cancelReason;
    }

    if (dto.status === 'delivered') {
      updateData.deliveredAt = new Date();
    }

    // Keep the office inbox posted on order lifecycle changes (notably
    // customer cancellations from the website). Fire-and-forget.
    if (dto.status !== order.status) {
      this.mailService.notifyOffice('Order Status Changed', {
        'Order Number': order.orderNumber,
        Customer: order.customer.fullName,
        Phone: order.customer.phone,
        Previous: order.status,
        New: dto.status,
        Reason: dto.status === 'cancelled' ? dto.cancelReason : undefined,
      });
    }

    return this.prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        items: { include: { product: true } },
        customer: { select: { id: true, fullName: true, email: true } },
      },
    });
  }
}
