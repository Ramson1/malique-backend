import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  CreateSaleDto,
  PosSalesQueryDto,
  VoidSaleDto,
} from './dto/pos.dto';
import { generateOrderNumber, isUniqueViolation } from '../orders/order-number.util';

const PRIVILEGED_ROLES = new Set(['super_admin', 'admin']);

interface AuthUser {
  id: string;
  role: string;
  branchId?: string | null;
}

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  // ─── Branch scoping ────────────────────────────────────────
  // staff/branch_manager are locked to their own branch; admin/super_admin may
  // target any branch. Never trust the client-supplied branch for a staff user.
  private resolveBranch(user: AuthUser, requested?: string): string {
    const privileged = PRIVILEGED_ROLES.has(user.role);
    if (privileged) {
      const branch = requested || user.branchId;
      if (!branch) {
        throw new BadRequestException('branchId is required');
      }
      return branch;
    }
    if (!user.branchId) {
      throw new ForbiddenException('Your account is not assigned to a branch');
    }
    if (requested && requested !== user.branchId) {
      throw new ForbiddenException('You can only transact for your own branch');
    }
    return user.branchId;
  }

  // ─── Catalog (sellable items for a branch) ─────────────────
  async catalog(user: AuthUser, branchId?: string) {
    const branch = this.resolveBranch(user, branchId);
    const now = new Date();

    const [inventory, prices] = await Promise.all([
      this.prisma.inventory.findMany({
        where: { branchId: branch, product: { isActive: true } },
        include: {
          product: {
            select: { id: true, name: true, category: true, basePrice: true },
          },
        },
        orderBy: { product: { name: 'asc' } },
      }),
      this.prisma.productPrice.findMany({
        where: { branchId: branch, effectiveFrom: { lte: now } },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    // Latest effective price per product+size.
    const priceMap = new Map<string, number>();
    for (const p of prices) {
      const key = `${p.productId}:${p.sizeKg}`;
      if (!priceMap.has(key) && (!p.effectiveTo || p.effectiveTo >= now)) {
        priceMap.set(key, Number(p.price));
      }
    }

    return {
      branchId: branch,
      items: inventory.map((inv) => {
        const key = `${inv.productId}:${inv.sizeKg}`;
        const price = priceMap.get(key) ?? Number(inv.product.basePrice);
        return {
          productId: inv.productId,
          name: inv.product.name,
          category: inv.product.category,
          sizeKg: Number(inv.sizeKg),
          price,
          onHand: inv.quantityOnHand,
          minStockLevel: inv.minStockLevel,
          lowStock: inv.quantityOnHand <= inv.minStockLevel,
        };
      }),
    };
  }

  // ─── Record a counter sale ─────────────────────────────────
  async createSale(user: AuthUser, dto: CreateSaleDto) {
    const branch = this.resolveBranch(user, dto.branchId);
    const now = new Date();

    // Fold duplicate lines (same product+size) so stock checks are per-item.
    const demand = new Map<string, { productId: string; sizeKg: number; qty: number }>();
    for (const item of dto.items) {
      const key = `${item.productId}:${item.sizeKg}`;
      const existing = demand.get(key);
      if (existing) existing.qty += item.quantity;
      else demand.set(key, { productId: item.productId, sizeKg: item.sizeKg, qty: item.quantity });
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const orderNumber = await generateOrderNumber(this.prisma);
      try {
        const createdId = await this.prisma.$transaction(async (tx) => {
          // Resolve or create the buyer. Registered phone wins; otherwise attach
          // to the branch walk-in account and capture the walk-in name in notes.
          let customer = dto.customerPhone
            ? await tx.customer.findFirst({ where: { phone: dto.customerPhone } })
            : null;
          let customerNote = '';
          if (!customer) {
            const walkInEmail = `walkin+${branch}@pos.malique.local`;
            customer = await tx.customer.findUnique({ where: { email: walkInEmail } });
            if (!customer) {
              customer = await tx.customer.create({
                data: {
                  email: walkInEmail,
                  password: await bcrypt.hash(crypto.randomUUID(), 10),
                  fullName: 'Walk-in Customer',
                  phone: dto.customerPhone || '0000000000',
                  defaultBranchId: branch,
                },
              });
            }
            if (dto.customerName) customerNote = `Customer: ${dto.customerName}`;
          }

          const prices = await tx.productPrice.findMany({
            where: { branchId: branch, effectiveFrom: { lte: now } },
            orderBy: { effectiveFrom: 'desc' },
          });
          const priceMap = new Map<string, number>();
          for (const p of prices) {
            const key = `${p.productId}:${p.sizeKg}`;
            if (!priceMap.has(key) && (!p.effectiveTo || p.effectiveTo >= now)) {
              priceMap.set(key, Number(p.price));
            }
          }

          // Validate stock and build item rows.
          const orderItems: Array<{
            productId: string;
            sizeKg: number;
            quantity: number;
            unitPrice: number;
            totalPrice: number;
            isRefill: boolean;
            cylinderSerial?: string;
          }> = [];
          let subtotal = 0;

          for (const item of dto.items) {
            const key = `${item.productId}:${item.sizeKg}`;
            const inv = await tx.inventory.findUnique({
              where: {
                branchId_productId_sizeKg: {
                  branchId: branch,
                  productId: item.productId,
                  sizeKg: item.sizeKg,
                },
              },
              include: { product: { select: { name: true, basePrice: true } } },
            });
            if (!inv) {
              throw new BadRequestException(
                `That item (${item.sizeKg}kg) is not stocked at this branch`,
              );
            }
            const demandQty = demand.get(key)?.qty ?? 0;
            if (inv.quantityOnHand < demandQty) {
              throw new BadRequestException(
                `Insufficient stock for ${inv.product.name} (${item.sizeKg}kg): only ${inv.quantityOnHand} on hand`,
              );
            }

            const unitPrice =
              item.unitPrice ?? priceMap.get(key) ?? Number(inv.product.basePrice);
            const totalPrice = unitPrice * item.quantity;
            subtotal += totalPrice;

            orderItems.push({
              productId: item.productId,
              sizeKg: item.sizeKg,
              quantity: item.quantity,
              unitPrice,
              totalPrice,
              isRefill: item.isRefill ?? false,
              cylinderSerial: item.cylinderSerial,
            });
          }

          const discount = dto.discount || 0;
          const total = Math.max(0, subtotal - discount);
          const amountPaid = dto.amountPaid ?? null;
          const paymentStatus =
            amountPaid == null || amountPaid >= total ? 'paid' : 'partial';
          const change = amountPaid != null ? Math.max(0, amountPaid - total) : 0;

          const notes = [dto.notes, customerNote].filter(Boolean).join(' — ') || null;

          const order = await tx.order.create({
            data: {
              orderNumber,
              customerId: customer.id,
              branchId: branch,
              orderType: 'walk_in' as any,
              status: 'confirmed' as any,
              subtotal,
              deliveryFee: 0,
              discount,
              totalAmount: total,
              paymentStatus: paymentStatus as any,
              paymentMethod: dto.paymentMethod as any,
              notes,
              createdBy: user.id,
              items: { create: orderItems },
            },
            include: { items: { include: { product: { select: { name: true, category: true } } } } },
          });

          // Decrement stock (single authoritative deduction per folded line).
          for (const { productId, sizeKg, qty } of demand.values()) {
            await tx.inventory.update({
              where: {
                branchId_productId_sizeKg: { branchId: branch, productId, sizeKg },
              },
              data: { quantityOnHand: { decrement: qty } },
            });
          }

          await tx.payment.create({
            data: {
              orderId: order.id,
              amount: amountPaid != null ? Math.min(amountPaid, total) : total,
              paymentMethod: dto.paymentMethod as any,
              status: 'success',
              paidAt: now,
              confirmedBy: user.id,
              metadata: { channel: 'portal-pos', change } as any,
            },
          });

          // Bump loyalty stats only for registered (non-walk-in) buyers.
          if (!customer.email.startsWith('walkin+')) {
            await tx.customer.update({
              where: { id: customer.id },
              data: { orderCount: { increment: 1 }, totalSpent: { increment: total } },
            });
          }

          // Read the row back with the regular client AFTER the transaction
          // commits — findOne() uses this.prisma and cannot see uncommitted
          // rows if called inside the transaction callback.
          return order.id;
        });
        const sale = await this.findOne(user, createdId);
        // Alert the official inbox on every counter sale — this same flow
        // backs the admin portal's "New Order", so both are covered.
        const cashier = await this.prisma.user
          .findUnique({ where: { id: user.id }, select: { fullName: true } })
          .catch(() => null);
        this.mail.notifyOffice('New Counter Sale', {
          'Order Number': sale.orderNumber,
          Branch: sale.branch?.name,
          Cashier: cashier?.fullName ?? 'Staff',
          Customer: sale.customer?.phone
            ? `${sale.customer.fullName} (${sale.customer.phone})`
            : 'Walk-in',
          Items: sale.items
            .map((it: any) => `${it.quantity} × ${it.product?.name ?? 'Item'} (${it.sizeKg}kg)`)
            .join(', '),
          Total: `NGN ${Number(sale.totalAmount).toLocaleString('en-NG')}`,
          Payment: `${dto.paymentMethod}${dto.amountPaid != null ? ` — paid NGN ${Number(dto.amountPaid).toLocaleString('en-NG')}` : ''}`,
        });
        return sale;
      } catch (err) {
        // Retry once if two concurrent sales grabbed the same order number.
        if (attempt === 0 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new BadRequestException('Could not generate a unique order number, please retry');
  }

  // ─── List transactions ─────────────────────────────────────
  async listSales(user: AuthUser, query: PosSalesQueryDto) {
    const branch = this.resolveBranch(user, query.branchId);
    const where: any = { branchId: branch };

    const mineOnly = query.mine === 'true' || (query.mine === undefined && !PRIVILEGED_ROLES.has(user.role) && !query.staffId);
    if (query.staffId) where.createdBy = query.staffId;
    else if (mineOnly) where.createdBy = user.id;

    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) {
        const end = new Date(query.to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (query.search) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { customer: { phone: { contains: query.search } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { product: { select: { name: true, category: true } } } },
          customer: { select: { id: true, fullName: true, phone: true, email: true } },
          payments: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total, page: query.page, limit: query.limit };
  }

  async findOne(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true, category: true } } } },
        customer: { select: { id: true, fullName: true, phone: true, email: true } },
        branch: { select: { id: true, name: true } },
        payments: true,
      },
    });
    if (!order) throw new NotFoundException('Transaction not found');
    if (!PRIVILEGED_ROLES.has(user.role) && order.branchId !== user.branchId) {
      throw new ForbiddenException('You cannot view transactions from another branch');
    }
    return order;
  }

  // ─── Void / refund ─────────────────────────────────────────
  async voidSale(user: AuthUser, id: string, dto: VoidSaleDto) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Transaction not found');
    if (!PRIVILEGED_ROLES.has(user.role) && order.branchId !== user.branchId) {
      throw new ForbiddenException('You cannot void transactions from another branch');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('This transaction is already voided');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: dto.reason },
      });
      // Restock exactly what was deducted.
      for (const item of order.items) {
        await tx.inventory
          .update({
            where: {
              branchId_productId_sizeKg: {
                branchId: order.branchId,
                productId: item.productId,
                sizeKg: item.sizeKg,
              },
            },
            data: { quantityOnHand: { increment: item.quantity } },
          })
          .catch(() => undefined); // item may have been un-stocked since; ignore
      }
      await tx.payment.updateMany({
        where: { orderId: id },
        data: { status: 'refunded' },
      });
    });

    // Money left the drawer — make sure the official inbox sees every void.
    this.mail.notifyOffice('POS Sale Voided', {
      'Order Number': order.orderNumber,
      'Total Refunded': `NGN ${Number(order.totalAmount).toLocaleString('en-NG')}`,
      Reason: dto.reason,
    });

    return this.findOne(user, id);
  }

  // ─── Cash-up summary ───────────────────────────────────────
  async summary(user: AuthUser, params: { branchId?: string; from?: string; to?: string; staffId?: string }) {
    const branch = this.resolveBranch(user, params.branchId);
    const where: any = { branchId: branch };
    if (params.staffId) where.createdBy = params.staffId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) {
        const end = new Date(params.to);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        items: { include: { product: { select: { category: true } } } },
        payments: true,
      },
    });

    const totals = {
      transactions: 0,
      grossSales: 0,
      discounts: 0,
      voided: 0,
      voidedCount: 0,
      byPaymentMethod: { cash: 0, transfer: 0, pos: 0, online: 0 } as Record<string, number>,
      gas: { quantity: 0, value: 0 },
      items: { quantity: 0, value: 0 },
    };

    for (const o of orders) {
      if (o.status === 'cancelled') {
        totals.voided += Number(o.totalAmount);
        totals.voidedCount += 1;
        continue;
      }
      totals.transactions += 1;
      totals.grossSales += Number(o.totalAmount);
      totals.discounts += Number(o.discount);

      const method = (o.paymentMethod || 'cash') as string;
      if (totals.byPaymentMethod[method] != null) totals.byPaymentMethod[method] += Number(o.totalAmount);

      for (const it of o.items) {
        const isGas = it.product?.category !== 'accessory';
        const bucket = isGas ? totals.gas : totals.items;
        bucket.quantity += it.quantity;
        bucket.value += Number(it.totalPrice);
      }
    }

    return { branchId: branch, range: { from: params.from, to: params.to }, ...totals };
  }

  // ─── Branch stock view ─────────────────────────────────────
  async inventory(user: AuthUser, branchId?: string) {
    const branch = this.resolveBranch(user, branchId);
    const rows = await this.prisma.inventory.findMany({
      where: { branchId: branch },
      include: {
        product: { select: { id: true, name: true, category: true, imageUrl: true } },
      },
      orderBy: [{ product: { category: 'asc' } }, { product: { name: 'asc' } }],
    });
    return {
      branchId: branch,
      data: rows.map((r) => ({
        productId: r.productId,
        productName: r.product.name,
        category: r.product.category,
        sizeKg: Number(r.sizeKg),
        quantityOnHand: r.quantityOnHand,
        minStockLevel: r.minStockLevel,
        lowStock: r.quantityOnHand <= r.minStockLevel,
        lastRestockedAt: r.lastRestockedAt,
      })),
    };
  }
}
