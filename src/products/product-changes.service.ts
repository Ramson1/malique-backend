import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CATEGORY_TO_DB, CATEGORY_TO_UI } from '../admin/admin.maps';
import { CreateProductChangeDto } from './dto/product-change.dto';

// Product change approvals: secretaries (portal staff/branch_manager) submit
// create/edit/price proposals here; nothing touches the live Product or
// ProductPrice rows until a super_admin/admin approves the request. The
// website catalog (GET /catalog) and POS both read the live tables only, so
// pending proposals are invisible system-wide by construction — new products
// are drafted with isActive:false and prices are written on approval.
@Injectable()
export class ProductChangesService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  private num(v: unknown): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  // Admin-UI shape for a live product (UI category token + primary size as
  // weight), used both for listProducts enrichment and the approve/review diff.
  private toUiProduct(p: any) {
    const sizes = Array.isArray(p.sizes) ? p.sizes.map((s: any) => Number(s)) : [];
    return {
      id: p.id,
      name: p.name,
      category: CATEGORY_TO_UI[p.category] ?? p.category,
      price: this.num(p.basePrice),
      weight: sizes.length ? sizes[0] : undefined,
      sizes,
      description: p.description ?? '',
      imageUrl: p.imageUrl ?? undefined,
      isActive: p.isActive,
    };
  }

  private currentFor(p: any) {
    const ui = this.toUiProduct(p);
    return {
      name: ui.name,
      category: ui.category,
      price: ui.price,
      weight: ui.weight ?? null,
      description: ui.description,
    };
  }

  // Stored proposals must be plain JSON (Decimal/Date objects never get in
  // because we only accept DTO numbers, but normalize defensively anyway).
  private normalizeProposal(type: string, dto: CreateProductChangeDto): any {
    if (type === 'price') {
      return {
        entries: (dto.entries ?? []).map((e) => ({
          sizeKg: Number(e.sizeKg),
          price: Number(e.price),
        })),
        allBranches: Boolean(dto.allBranches),
        branchId: dto.branchId ?? null,
      };
    }
    return {
      name: dto.name,
      category: dto.category,
      weight: dto.weight !== undefined ? Number(dto.weight) : undefined,
      price: dto.price !== undefined ? Number(dto.price) : undefined,
      description: dto.description,
      imageUrl: dto.imageUrl,
    };
  }

  async submit(user: any, dto: CreateProductChangeDto) {
    const type = dto.type;
    if (!['create', 'edit', 'price'].includes(type)) {
      throw new BadRequestException('Unknown change type');
    }

    const validCategory = (c: string) =>
      ['refill', 'new_cylinder', 'accessory'].includes(c) || c in CATEGORY_TO_DB;

    if (type === 'create' || type === 'edit') {
      if (type === 'create') {
        if (!dto.name || dto.name.trim().length < 2) {
          throw new BadRequestException('Product name is required');
        }
        if (!dto.category || !validCategory(dto.category)) {
          throw new BadRequestException('A valid category is required');
        }
        if (dto.price === undefined || !Number.isFinite(Number(dto.price)) || Number(dto.price) < 0) {
          throw new BadRequestException('A price of 0 or more is required');
        }
      }
      if (dto.name !== undefined && dto.name.trim().length < 2) {
        throw new BadRequestException('Product name is too short');
      }
      if (dto.category !== undefined && !validCategory(dto.category)) {
        throw new BadRequestException('Unknown category');
      }
      if (dto.price !== undefined && (!Number.isFinite(Number(dto.price)) || Number(dto.price) < 0)) {
        throw new BadRequestException('Price must be 0 or more');
      }
      if (
        dto.weight !== undefined &&
        (!Number.isFinite(Number(dto.weight)) || Number(dto.weight) <= 0)
      ) {
        throw new BadRequestException('Weight (kg size) must be a positive number');
      }
      if (type === 'edit') {
        if (!dto.productId) throw new BadRequestException('productId is required');
        const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
        if (!product) throw new NotFoundException('Product not found');
      }
    } else {
      if (!dto.productId) throw new BadRequestException('productId is required');
      const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException('Product not found');
      const entries = (dto.entries ?? [])
        .map((e) => ({ sizeKg: Number(e.sizeKg), price: Number(e.price) }))
        .filter(
          (e) => Number.isFinite(e.sizeKg) && e.sizeKg >= 0 && Number.isFinite(e.price) && e.price >= 0,
        );
      if (!entries.length) {
        throw new BadRequestException('No valid price entries supplied');
      }
      const branches = await this.prisma.branch.count({ where: { status: 'active' } });
      if (!branches) throw new BadRequestException('No active branch to price');
      if (!dto.allBranches && !dto.branchId) {
        throw new BadRequestException('Pick a branch or apply to all branches');
      }
    }

    const proposal = this.normalizeProposal(type, dto);
    const created = await this.prisma.productChangeRequest.create({
      data: {
        type,
        productId: type === 'create' ? null : dto.productId ?? null,
        proposal: proposal as Prisma.InputJsonValue,
        requestedById: user.id,
      },
    });

    this.mail.notifyOffice('New Product Change Request', {
      Type: this.typeLabel(type),
      Product: await this.describeTarget(type, dto, proposal),
      'Requested By': user.fullName ?? user.email,
      Details: this.detailLine(type, proposal),
    });

    return this.detail(created.id);
  }

  private typeLabel(type: string): string {
    return type === 'create'
      ? 'New product'
      : type === 'edit'
        ? 'Product edit'
        : 'Price change';
  }

  private async describeTarget(type: string, dto: CreateProductChangeDto, proposal: any) {
    if (type === 'create') return proposal.name ?? '(untitled)';
    const product = dto.productId
      ? await this.prisma.product.findUnique({ where: { id: dto.productId } })
      : null;
    return product ? product.name : '(deleted product)';
  }

  private detailLine(type: string, proposal: any): string {
    if (type === 'price') {
      return (proposal.entries ?? [])
        .map((e: any) => `${e.sizeKg}kg → ₦${Number(e.price).toLocaleString('en-NG')}`)
        .join(', ');
    }
    const bits: string[] = [];
    if (proposal.name) bits.push(proposal.name);
    if (proposal.weight) bits.push(`${proposal.weight}kg`);
    if (proposal.price !== undefined) bits.push(`₦${Number(proposal.price).toLocaleString('en-NG')}`);
    return bits.join(' · ');
  }

  // Review queue for admins: every pending request with the live product
  // snapshot attached so the UI can render a current → proposed diff.
  async list(user: any, status?: string) {
    const privileged = ['super_admin', 'admin'].includes(user.role);
    const where: any = privileged ? {} : { requestedById: user.id };
    if (status) {
      where.status = status;
    }
    const rows = await this.prisma.productChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, category: true, basePrice: true, sizes: true, description: true } },
        requestedBy: { select: { fullName: true, email: true } },
      },
    });
    return {
      requests: rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        productId: r.productId,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        requestedBy: r.requestedBy?.fullName ?? null,
        proposal: r.proposal,
        current: r.product ? this.currentFor(r.product) : null,
        productName: r.product?.name ?? null,
      })),
    };
  }

  // Bell badge: admins see the whole queue, everyone else only their own.
  async pendingCount(user: any) {
    const privileged = ['super_admin', 'admin'].includes(user.role);
    const count = await this.prisma.productChangeRequest.count({
      where: privileged ? { status: 'pending' } : { status: 'pending', requestedById: user.id },
    });
    return { count };
  }

  async detail(id: string) {
    const r = await this.prisma.productChangeRequest.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, category: true, basePrice: true, sizes: true, description: true } },
        requestedBy: { select: { fullName: true, email: true } },
        reviewedBy: { select: { fullName: true } },
      },
    });
    if (!r) throw new NotFoundException('Change request not found');
    return {
      id: r.id,
      type: r.type,
      productId: r.productId,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      requestedBy: r.requestedBy?.fullName ?? null,
      reviewedBy: r.reviewedBy?.fullName ?? null,
      proposal: r.proposal,
      current: r.product ? this.currentFor(r.product) : null,
      productName: r.product?.name ?? null,
    };
  }

  async approve(user: any, id: string) {
    const req = await this.prisma.productChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Change request not found');
    if (req.status !== 'pending') {
      throw new BadRequestException(`Request already ${req.status}`);
    }

    // Race-safe claim: only the first reviewer flips pending → approved.
    const claim = await this.prisma.productChangeRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'approved',
        reviewedById: user.id,
        reviewedAt: new Date(),
        reason: null,
      },
    });
    if (claim.count !== 1) {
      throw new ConflictException('Request was already reviewed by someone else');
    }

    const proposal: any = req.proposal as any;
    let liveProductId = req.productId;

    await this.prisma.$transaction(async (tx: any) => {
      if (req.type === 'create') {
        const created = await tx.product.create({
          data: {
            name: String(proposal.name),
            category: (CATEGORY_TO_DB[proposal.category] ?? proposal.category) as any,
            sizes: proposal.weight ? [Number(proposal.weight)] : [],
            basePrice: Number(proposal.price ?? 0),
            description: proposal.description ?? null,
            imageUrl: proposal.imageUrl ?? null,
            isActive: false, // drafted live on approval via the activate step below
          },
        });
        liveProductId = created.id;
      } else if (req.type === 'edit') {
        const data: any = {};
        if (proposal.name !== undefined) data.name = proposal.name;
        if (proposal.description !== undefined) data.description = proposal.description;
        if (proposal.category !== undefined) {
          data.category = CATEGORY_TO_DB[proposal.category] ?? proposal.category;
        }
        if (proposal.price !== undefined) data.basePrice = Number(proposal.price);
        if (proposal.weight !== undefined && proposal.weight !== null) {
          data.sizes = [Number(proposal.weight)];
        }
        await tx.product.update({ where: { id: req.productId as string }, data });
      } else if (req.type === 'price') {
        await this.applyPrices(tx, req.productId as string, proposal);
      }
    });

    // New product approved → publish it everywhere (website catalog + POS).
    if (req.type === 'create' && liveProductId) {
      await this.prisma.product.update({
        where: { id: liveProductId },
        data: { isActive: true },
      });
      // Link the finished request to the product it created so the audit
      // trail (and supersede checks) can find it by productId later.
      await this.prisma.productChangeRequest.update({
        where: { id },
        data: { productId: liveProductId },
      });
    }

    if (liveProductId) {
      await this.prisma.productChangeRequest.updateMany({
        where: { productId: liveProductId, status: 'pending', id: { not: id } },
        data: { status: 'superseded', reason: 'Replaced by an approved change' },
      });
    }

    this.mail.notifyOffice('Product Change Approved', {
      Type: this.typeLabel(req.type),
      Product: liveProductId
        ? (await this.prisma.product.findUnique({ where: { id: liveProductId }, select: { name: true } }))?.name
        : undefined,
      'Requested By': (await this.prisma.user.findUnique({ where: { id: req.requestedById }, select: { fullName: true } }).catch(() => null))?.fullName,
      'Approved By': user.fullName ?? user.email,
      Details: this.detailLine(req.type, proposal),
    });

    return this.detail(id);
  }

  // Same per-(branch,size) upsert semantics as AdminService.setProductPrices,
  // executed inside the approve transaction so nothing lands half-applied.
  private async applyPrices(tx: any, productId: string, proposal: any) {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product no longer exists');

    const entries: { sizeKg: number; price: number }[] = (
      Array.isArray(proposal?.entries) ? proposal.entries : []
    )
      .map((e: any) => ({ sizeKg: Number(e.sizeKg), price: Number(e.price) }))
      .filter(
        (e: any) => Number.isFinite(e.sizeKg) && e.sizeKg >= 0 && Number.isFinite(e.price) && e.price >= 0,
      );
    if (!entries.length) throw new BadRequestException('No valid price entries supplied');

    const branchIds: string[] = proposal?.allBranches
      ? (
          await tx.branch.findMany({
            where: { status: 'active' },
            select: { id: true },
          })
        ).map((b: any) => b.id)
      : proposal?.branchId
        ? [String(proposal.branchId)]
        : [];
    if (!branchIds.length) throw new BadRequestException('Pick a branch or apply to all branches');

    for (const branchId of branchIds) {
      for (const entry of entries) {
        const existing = await tx.productPrice.findFirst({
          where: { productId, branchId, sizeKg: entry.sizeKg },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (existing) {
          await tx.productPrice.update({
            where: { id: existing.id },
            data: { price: entry.price },
          });
        } else {
          await tx.productPrice.create({
            data: {
              productId,
              branchId,
              sizeKg: entry.sizeKg,
              price: entry.price,
              effectiveFrom: new Date(),
            },
          });
        }
      }
    }

    // Keep basePrice coherent (per-kg fallback anchor), same as admin flow.
    const primary = Array.isArray(product.sizes) ? Number(product.sizes[0]) : null;
    const primaryEntry = entries.find((e) => Number(e.sizeKg) === primary);
    if (primaryEntry) {
      await tx.product.update({
        where: { id: productId },
        data: { basePrice: primaryEntry.price },
      });
    }
  }

  async reject(user: any, id: string, reason: string) {
    const req = await this.prisma.productChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Change request not found');
    if (req.status !== 'pending') {
      throw new BadRequestException(`Request already ${req.status}`);
    }

    const claim = await this.prisma.productChangeRequest.updateMany({
      where: { id, status: 'pending' },
      data: {
        status: 'rejected',
        reviewedById: user.id,
        reviewedAt: new Date(),
        reason,
      },
    });
    if (claim.count !== 1) {
      throw new ConflictException('Request was already reviewed by someone else');
    }

    this.mail.notifyOffice('Product Change Rejected', {
      Type: this.typeLabel(req.type),
      Product: req.productId
        ? (await this.prisma.product.findUnique({ where: { id: req.productId }, select: { name: true } }).catch(() => null))?.name
        : ((req.proposal as any)?.name ?? undefined),
      'Requested By': (await this.prisma.user.findUnique({ where: { id: req.requestedById }, select: { fullName: true } }).catch(() => null))?.fullName,
      'Rejected By': user.fullName ?? user.email,
      Reason: reason,
    });

    return this.detail(id);
  }

  async withdraw(user: any, id: string) {
    const req = await this.prisma.productChangeRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Change request not found');
    if (req.requestedById !== user.id) {
      throw new ForbiddenException('You can only withdraw your own requests');
    }
    if (req.status !== 'pending') {
      throw new BadRequestException(`Request already ${req.status}`);
    }
    await this.prisma.productChangeRequest.update({
      where: { id },
      data: { status: 'superseded', reason: 'Withdrawn by requester' },
    });
    return this.detail(id);
  }
}
