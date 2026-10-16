import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateAddressDto } from './dto/address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async getProfile(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        address: true,
        defaultBranchId: true,
        latitude: true,
        longitude: true,
        loyaltyPoints: true,
        totalSpent: true,
        orderCount: true,
        createdAt: true,
        defaultBranch: {
          select: { id: true, name: true, address: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer;
  }

  async updateProfile(customerId: string, dto: UpdateProfileDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return this.prisma.customer.update({
      where: { id: customerId },
      data: { ...dto },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        address: true,
        defaultBranchId: true,
        latitude: true,
        longitude: true,
      },
    });
  }

  async getOrderHistory(customerId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { product: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.order.count({ where: { customerId } }),
    ]);

    return {
      data: orders,
      total,
      page,
      limit,
    };
  }

  async getAddresses(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { savedAddresses: true },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return customer.savedAddresses || [];
  }

  async addAddress(customerId: string, dto: CreateAddressDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const addresses = (customer.savedAddresses as any[]) || [];
    const newAddress = {
      id: `addr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...dto,
      createdAt: new Date().toISOString(),
    };

    addresses.push(newAddress);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { savedAddresses: addresses },
    });

    return newAddress;
  }

  async updateAddress(customerId: string, addressId: string, dto: UpdateAddressDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const addresses = (customer.savedAddresses as any[]) || [];
    const index = addresses.findIndex((addr: any) => addr.id === addressId);

    if (index === -1) {
      throw new NotFoundException('Address not found');
    }

    addresses[index] = { ...addresses[index], ...dto, updatedAt: new Date().toISOString() };

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { savedAddresses: addresses },
    });

    return addresses[index];
  }

  async removeAddress(customerId: string, addressId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const addresses = (customer.savedAddresses as any[]) || [];
    const filtered = addresses.filter((addr: any) => addr.id !== addressId);

    if (filtered.length === addresses.length) {
      throw new NotFoundException('Address not found');
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: { savedAddresses: filtered },
    });

    return { message: 'Address removed successfully' };
  }
}
