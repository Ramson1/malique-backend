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
          mon: '07:00-19:00',
          tue: '07:00-19:00',
          wed: '07:00-19:00',
          thu: '07:00-19:00',
          fri: '07:00-19:00',
          sat: '07:00-19:00',
          sun: '10:00-19:00',
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
