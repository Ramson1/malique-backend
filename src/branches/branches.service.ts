import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/create-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.branch.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { users: true, customers: true, orders: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, customers: true, orders: true },
        },
      },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async create(dto: CreateBranchDto) {
    return this.prisma.branch.create({
      data: {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        latitude: dto.latitude,
        longitude: dto.longitude,
        operatingHours: dto.operatingHours || {
          mon: '08:00-20:00',
          tue: '08:00-20:00',
          wed: '08:00-20:00',
          thu: '08:00-20:00',
          fri: '08:00-20:00',
          sat: '08:00-18:00',
          sun: 'closed',
        },
        deliveryRadiusKm: dto.deliveryRadiusKm || 25,
      },
    });
  }

  async update(id: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return this.prisma.branch.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.status ? { status: dto.status as any } : {}),
      },
    });
  }
}
