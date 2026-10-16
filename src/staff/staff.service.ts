import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}

  async findAll(pagination: PaginationDto, branchId?: string, role?: string) {
    const where: any = {
      role: { in: ['staff', 'branch_manager', 'rider'] },
    };
    if (branchId) where.branchId = branchId;
    if (role) where.role = role;

    const [staff, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          branchId: true,
          avatarUrl: true,
          status: true,
          lastLogin: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: staff,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: { in: ['staff', 'branch_manager', 'rider'] },
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        avatarUrl: true,
        status: true,
        lastLogin: true,
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('Staff member not found');
    }

    return user;
  }

  async create(dto: CreateStaffDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        fullName: dto.fullName,
        phone: dto.phone,
        role: dto.role as any,
        branchId: dto.branchId,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });

    return user;
  }

  async update(id: string, dto: UpdateStaffDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: { in: ['staff', 'branch_manager', 'rider'] },
      },
    });

    if (!user) {
      throw new NotFoundException('Staff member not found');
    }

    if (dto.email && dto.email !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existingUser) {
        throw new ConflictException('Email already in use');
      }
    }

    const updateData: any = { ...dto };
    if (dto.password) {
      updateData.password = await bcrypt.hash(dto.password, 12);
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        avatarUrl: true,
        status: true,
        lastLogin: true,
        createdAt: true,
      },
    });
  }

  async remove(id: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        role: { in: ['staff', 'branch_manager', 'rider'] },
      },
    });

    if (!user) {
      throw new NotFoundException('Staff member not found');
    }

    // Soft-delete by setting status to inactive
    await this.prisma.user.update({
      where: { id },
      data: { status: 'inactive' },
    });

    return { message: 'Staff member deactivated successfully' };
  }
}
