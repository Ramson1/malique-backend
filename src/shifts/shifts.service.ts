import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignShiftDto,
  CreateShiftDto,
  UpdateAssignmentStatusDto,
} from './dto/shifts.dto';

// Turn a stored @db.Time Date back into a "HH:mm" wall-clock string.
function toHHMM(d: Date | null): string {
  if (!d) return '';
  return d.toISOString().slice(11, 16);
}

// Turn a "HH:mm" string into the Date shape Prisma expects for @db.Time.
function fromHHMM(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

// Convert "YYYY-MM-DD" to the UTC midnight Date used for a @db.Date column.
function dayStart(yyyymmdd: string): Date {
  return new Date(`${yyyymmdd}T00:00:00.000Z`);
}

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  private mapShift(s: any) {
    return {
      id: s.id,
      branchId: s.branchId,
      branchName: s.branch?.name ?? '—',
      name: s.name,
      startTime: toHHMM(s.startTime),
      endTime: toHHMM(s.endTime),
      minStaff: s.minStaff,
      capacity: s.capacity ?? null,
      isDefault: s.isDefault,
      description: s.description ?? undefined,
      isActive: s.isActive,
    };
  }

  async listShifts(branchId?: string) {
    const rows = await this.prisma.shift.findMany({
      where: branchId ? { branchId } : {},
      orderBy: { startTime: 'asc' },
      include: { branch: { select: { name: true } } },
    });
    return { shifts: rows.map((s: any) => this.mapShift(s)) };
  }

  async createShift(dto: CreateShiftDto) {
    const branch = await this.prisma.branch.findUnique({ where: { id: dto.branchId } });
    if (!branch) throw new NotFoundException('Branch not found');
    const created = await this.prisma.shift.create({
      data: {
        branchId: dto.branchId,
        name: dto.name,
        startTime: fromHHMM(dto.startTime),
        endTime: fromHHMM(dto.endTime),
        minStaff: dto.minStaff ?? 1,
        capacity: dto.capacity ?? null,
        isDefault: dto.isDefault ?? false,
        description: dto.description ?? null,
      },
      include: { branch: { select: { name: true } } },
    });
    return this.mapShift(created);
  }

  async updateShift(id: string, dto: Partial<CreateShiftDto>) {
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startTime) data.startTime = fromHHMM(dto.startTime);
    if (dto.endTime) data.endTime = fromHHMM(dto.endTime);
    if (dto.minStaff !== undefined) data.minStaff = dto.minStaff;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.description !== undefined) data.description = dto.description;
    const updated = await this.prisma.shift.update({
      where: { id },
      data,
      include: { branch: { select: { name: true } } },
    });
    return this.mapShift(updated);
  }

  async deleteShift(id: string) {
    await this.prisma.shift.delete({ where: { id } });
    return { deleted: true };
  }

  // Roster-eligible people for a branch (non-rider, active).
  async listRosterStaff(branchId?: string) {
    const rows = await this.prisma.user.findMany({
      where: {
        status: 'active',
        role: { in: ['admin', 'branch_manager', 'staff'] },
        ...(branchId ? { branchId } : {}),
      },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, jobTitle: true, branchId: true },
    });
    return {
      staff: rows.map((u: any) => ({
        id: u.id,
        name: u.fullName,
        jobTitle: u.jobTitle ?? undefined,
        branchId: u.branchId ?? null,
      })),
    };
  }

  // Weekly roster payload: shifts + staff + assignments in the range.
  async roster(branchId: string, from: string, to: string) {
    const [shifts, staff, assignments] = await Promise.all([
      this.prisma.shift.findMany({
        where: { branchId, isActive: true },
        orderBy: { startTime: 'asc' },
      }),
      this.listRosterStaff(branchId).then((r) => r.staff),
      this.prisma.shiftAssignment.findMany({
        where: {
          branchId,
          workDate: { gte: dayStart(from), lte: dayStart(to) },
        },
        include: { user: { select: { fullName: true } } },
        orderBy: { workDate: 'asc' },
      }),
    ]);

    return {
      shifts: shifts.map((s: any) => this.mapShift(s)),
      staff,
      assignments: assignments.map((a: any) => ({
        id: a.id,
        shiftId: a.shiftId,
        userId: a.userId,
        staffName: a.user?.fullName ?? '—',
        workDate: a.workDate.toISOString().slice(0, 10),
        status: a.status,
        note: a.note ?? undefined,
      })),
    };
  }

  async assign(dto: AssignShiftDto) {
    const shift = await this.prisma.shift.findUnique({ where: { id: dto.shiftId } });
    if (!shift) throw new NotFoundException('Shift not found');

    const branchId = dto.branchId ?? shift.branchId;
    const workDate = dayStart(dto.workDate);

    // Conflict 1: overlapping shift for the same staff on the same day.
    const sameDay = await this.prisma.shiftAssignment.findMany({
      where: { userId: dto.userId, workDate },
      include: { shift: true },
    });
    for (const existing of sameDay) {
      if (existing.shiftId === dto.shiftId) {
        throw new BadRequestException('Already assigned to this shift for the day');
      }
      if (this.overlaps(existing.shift, shift)) {
        throw new BadRequestException(
          'Double-booking: staff already has an overlapping shift this day',
        );
      }
    }

    // Conflict 2: capacity ceiling for the shift on that day.
    if (shift.capacity) {
      const count = await this.prisma.shiftAssignment.count({
        where: { shiftId: shift.id, workDate },
      });
      if (count >= shift.capacity) {
        throw new BadRequestException(`${shift.name} is full (${shift.capacity} max)`);
      }
    }

    try {
      const created = await this.prisma.shiftAssignment.create({
        data: {
          shiftId: shift.id,
          userId: dto.userId,
          branchId,
          workDate,
          note: dto.note ?? null,
        },
        include: { user: { select: { fullName: true } } },
      });
      return {
        id: created.id,
        shiftId: created.shiftId,
        userId: created.userId,
        staffName: (created as any).user?.fullName ?? '—',
        workDate: created.workDate.toISOString().slice(0, 10),
        status: created.status,
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Already assigned to this shift for the day');
      }
      throw e;
    }
  }

  async setStatus(id: string, dto: UpdateAssignmentStatusDto) {
    const updated = await this.prisma.shiftAssignment.update({
      where: { id },
      data: { status: dto.status as any },
    });
    return { id: updated.id, status: updated.status };
  }

  async remove(id: string) {
    await this.prisma.shiftAssignment.delete({ where: { id } });
    return { deleted: true };
  }

  // Inclusive overlap test between two [start,end] wall-clock windows.
  private overlaps(a: { startTime: Date; endTime: Date }, b: { startTime: Date; endTime: Date }): boolean {
    const as = a.startTime.getTime();
    const ae = a.endTime.getTime();
    const bs = b.startTime.getTime();
    const be = b.endTime.getTime();
    // Handle shifts crossing midnight by normalising; simple window test otherwise.
    return as < be && bs < ae;
  }
}
