import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { resolveUnitPrice } from './price.util';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  // Public website catalog: active products with the live, branch-resolved
  // price for every size. The wizard and the server-side order intake both
  // rely on this same resolution (price.util), so displayed price ==
  // charged price.
  async catalog(branchId?: string) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    const prices = products.length
      ? await this.prisma.productPrice.findMany({
          where: {
            productId: { in: products.map((p) => p.id) },
            ...(branchId ? { branchId } : {}),
          },
        })
      : [];

    const data = products.map((product) => {
      const productPrices = prices.filter((p) => p.productId === product.id);
      const sizes =
        Array.isArray(product.sizes) && product.sizes.length
          ? product.sizes
          : [0]; // accessories without explicit sizes: single priced option
      return {
        id: product.id,
        name: product.name,
        category: product.category,
        description: product.description,
        imageUrl: product.imageUrl,
        options: sizes.map((kg) => ({
          sizeKg: kg,
          price: resolveUnitPrice(product, productPrices, kg),
        })),
      };
    });

    return { branchId: branchId ?? null, data };
  }

  async findAll(pagination: PaginationDto, category?: string) {
    const where: any = {};
    if (category) {
      where.category = category;
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        include: {
          prices: {
            orderBy: { effectiveFrom: 'desc' },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        prices: {
          orderBy: { effectiveFrom: 'desc' },
          include: { branch: true },
        },
        inventory: {
          include: { branch: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        name: dto.name,
        category: dto.category as any,
        sizes: dto.sizes || [],
        basePrice: dto.basePrice || 0,
        description: dto.description,
        imageUrl: dto.imageUrl,
      },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.category ? { category: dto.category as any } : {}),
      },
    });
  }

  async remove(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
