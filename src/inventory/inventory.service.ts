import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async findByBranch(branchId: string, pagination: PaginationDto) {
    const where = { branchId };

    const [inventory, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { updatedAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, category: true, imageUrl: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.inventory.count({ where }),
    ]);

    return {
      data: inventory,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async adjustStock(
    branchId: string,
    productId: string,
    sizeKg: number,
    quantityChange: number,
    userId: string,
  ) {
    // Find existing inventory record
    let inventory = await this.prisma.inventory.findFirst({
      where: { branchId, productId, sizeKg },
    });

    if (!inventory) {
      // Create new inventory record if it doesn't exist
      inventory = await this.prisma.inventory.create({
        data: {
          branchId,
          productId,
          sizeKg,
          quantityOnHand: quantityChange > 0 ? quantityChange : 0,
          minStockLevel: 5,
          maxCapacity: 500,
          lastRestockedAt: quantityChange > 0 ? new Date() : null,
        },
        include: {
          product: { select: { id: true, name: true, category: true } },
          branch: { select: { id: true, name: true } },
        },
      });

      return inventory;
    }

    const newQuantity = inventory.quantityOnHand + quantityChange;

    if (newQuantity < 0) {
      throw new BadRequestException(
        `Insufficient stock. Current quantity: ${inventory.quantityOnHand}, requested change: ${quantityChange}`,
      );
    }

    const updateData: any = {
      quantityOnHand: newQuantity,
    };

    // Update last restocked time if adding stock
    if (quantityChange > 0) {
      updateData.lastRestockedAt = new Date();
    }

    return this.prisma.inventory.update({
      where: { id: inventory.id },
      data: updateData,
      include: {
        product: { select: { id: true, name: true, category: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async getLowStock(branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;

    // Fetch all inventory items and filter in memory for low stock
    const allItems = await this.prisma.inventory.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, category: true, imageUrl: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { quantityOnHand: 'asc' },
    });

    // Filter items where quantity is at or below minimum stock level
    const lowStockItems = allItems.filter(
      (item) => item.quantityOnHand <= item.minStockLevel,
    );

    return {
      data: lowStockItems,
      total: lowStockItems.length,
    };
  }
}
