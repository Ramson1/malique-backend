import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ClockInDto } from './dto/clock-in.dto';
import { VerifyClockDto, VerifyClockOutDto } from './dto/verify-clock.dto';
import { verifyBadgeToken } from './checkin-token';
import { PaginationDto } from '../common/dto/pagination.dto';

// Roles that can physically clock in at a branch.
const CLOCKABLE_ROLES = new Set(['staff', 'branch_manager', 'admin']);

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async clockIn(userId: string, dto: ClockInDto) {
    // Check if user already has an active clock-in (no clockOut)
    const activeAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
    });

    if (activeAttendance) {
      throw new BadRequestException('You are already clocked in. Please clock out first.');
    }

    return this.prisma.attendance.create({
      data: {
        userId,
        branchId: dto.branchId,
        shiftType: (dto.shiftType as any) || 'full_day',
        notes: dto.notes,
      },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async clockOut(userId: string, notes?: string) {
    const activeAttendance = await this.prisma.attendance.findFirst({
      where: {
        userId,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    if (!activeAttendance) {
      throw new NotFoundException('No active clock-in found. Please clock in first.');
    }

    const clockOut = new Date();
    const diff = clockOut.getTime() - activeAttendance.clockIn.getTime();
    const totalHours = Math.round((diff / 3600000) * 100) / 100; // hours with 2 decimals

    return this.prisma.attendance.update({
      where: { id: activeAttendance.id },
      data: {
        clockOut,
        totalHours,
        notes: notes || activeAttendance.notes,
      },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Anti-fraud check-in (possession + knowledge) ──────
  // Resolve the staff subject from a scanned signed badge OR a typed staff
  // code, always requiring their secret PIN before any clock event is written.
  private async resolveStaff(subject: {
    staffCode?: string;
    qrToken?: string;
    pin: string;
  }) {
    let user: any = null;

    if (subject.qrToken) {
      const parsed = verifyBadgeToken(subject.qrToken);
      if (!parsed) {
        throw new UnauthorizedException('Invalid or tampered badge QR code');
      }
      user = await this.prisma.user.findUnique({ where: { id: parsed.userId } });
      if (!user || user.staffCode !== parsed.staffCode) {
        throw new UnauthorizedException('Badge does not match any active staff record');
      }
    } else if (subject.staffCode) {
      user = await this.prisma.user.findFirst({
        where: { staffCode: subject.staffCode },
      });
    } else {
      throw new BadRequestException('Scan a badge or enter a staff code');
    }

    if (!user) throw new NotFoundException('Staff not found');
    if (!CLOCKABLE_ROLES.has(user.role)) {
      throw new ForbiddenException('This account cannot clock in');
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('Staff account is inactive');
    }
    if (!user.pinHash) {
      throw new BadRequestException(
        'No check-in PIN set. Ask an administrator to assign one.',
      );
    }
    const ok = await bcrypt.compare(subject.pin, user.pinHash);
    if (!ok) throw new UnauthorizedException('Incorrect PIN');

    return user;
  }

  async verifyClock(dto: VerifyClockDto) {
    const user = await this.resolveStaff(dto);

    // Guard against clocking in at the wrong branch when one is on record.
    if (user.branchId && dto.branchId && user.branchId !== dto.branchId) {
      throw new ForbiddenException('Wrong branch for this staff member');
    }

    const active = await this.prisma.attendance.findFirst({
      where: { userId: user.id, clockOut: null },
    });
    if (active) {
      throw new BadRequestException(`${user.fullName} is already clocked in`);
    }

    const created = await this.prisma.attendance.create({
      data: {
        userId: user.id,
        branchId: dto.branchId,
        status: 'present',
        verificationMethod: dto.qrToken ? 'qr' : 'pin',
        pinVerified: true,
        deviceInfo: dto.deviceInfo ?? null,
        location: dto.location ?? null,
      },
      include: {
        user: { select: { id: true, fullName: true, staffCode: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    return {
      success: true,
      message: `${created.user.fullName} clocked in`,
      method: dto.qrToken ? 'qr' : 'pin',
      clockIn: created.clockIn.toISOString(),
    };
  }

  async verifyClockOut(dto: VerifyClockOutDto) {
    const user = await this.resolveStaff(dto);

    const active = await this.prisma.attendance.findFirst({
      where: { userId: user.id, clockOut: null },
      orderBy: { clockIn: 'desc' },
    });
    if (!active) {
      throw new NotFoundException(`${user.fullName} is not currently clocked in`);
    }

    const clockOut = new Date();
    const totalHours =
      Math.round(((clockOut.getTime() - active.clockIn.getTime()) / 3600000) * 100) / 100;

    const updated = await this.prisma.attendance.update({
      where: { id: active.id },
      data: {
        clockOut,
        totalHours,
        verificationMethod: dto.qrToken ? 'qr' : 'pin',
        pinVerified: true,
      },
      include: {
        user: { select: { id: true, fullName: true, staffCode: true } },
        branch: { select: { id: true, name: true } },
      },
    });

    return {
      success: true,
      message: `${updated.user.fullName} clocked out`,
      totalHours,
    };
  }

  async findAll(
    pagination: PaginationDto,
    userId?: string,
    branchId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (branchId) where.branchId = branchId;

    if (startDate || endDate) {
      where.clockIn = {};
      if (startDate) where.clockIn.gte = new Date(startDate);
      if (endDate) where.clockIn.lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const [records, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { clockIn: 'desc' },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      data: records,
      total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }
}
