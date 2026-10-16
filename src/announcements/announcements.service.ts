import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

// Announcements are admin-authored broadcasts surfaced on the marketing
// website (stock availability, promo prices, price news, general updates).
@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  private map(a: any) {
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      type: a.type,
      status: a.status,
      pinned: a.pinned,
      linkLabel: a.linkLabel ?? undefined,
      linkUrl: a.linkUrl ?? undefined,
      startsAt: a.startsAt ? new Date(a.startsAt).toISOString() : undefined,
      endsAt: a.endsAt ? new Date(a.endsAt).toISOString() : undefined,
      publishedAt: a.publishedAt ? new Date(a.publishedAt).toISOString() : undefined,
      createdAt: new Date(a.createdAt).toISOString(),
      updatedAt: new Date(a.updatedAt).toISOString(),
    };
  }

  // Public feed: only published rows that are inside their active window,
  // pinned first then newest.
  async active() {
    const now = new Date();
    const rows = await this.prisma.announcement.findMany({
      where: {
        status: 'published',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 30,
    });
    return { announcements: rows.map((a: any) => this.map(a)) };
  }

  async list(status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const rows = await this.prisma.announcement.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
    return { announcements: rows.map((a: any) => this.map(a)) };
  }

  async one(id: string) {
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new BadRequestException('Announcement not found');
    return this.map(a);
  }

  async create(dto: CreateAnnouncementDto, actorId?: string) {
    const status = dto.status ?? 'published';
    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        type: dto.type ?? 'general',
        status,
        pinned: dto.pinned ?? false,
        linkLabel: dto.linkLabel?.trim() || null,
        linkUrl: dto.linkUrl?.trim() || null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        publishedById: actorId ?? null,
        publishedAt: status === 'published' ? new Date() : null,
      },
    });
    return this.map(created);
  }

  async update(id: string, dto: UpdateAnnouncementDto, actorId?: string) {
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.body !== undefined) data.body = dto.body.trim();
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.linkLabel !== undefined) data.linkLabel = dto.linkLabel?.trim() || null;
    if (dto.linkUrl !== undefined) data.linkUrl = dto.linkUrl?.trim() || null;
    if (dto.startsAt !== undefined) data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.endsAt !== undefined) data.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.status !== undefined) {
      data.status = dto.status;
      // Stamp publishedAt the first time it goes live.
      if (dto.status === 'published') {
        const existing = await this.prisma.announcement.findUnique({ where: { id } });
        if (!existing) throw new BadRequestException('Announcement not found');
        if (!existing.publishedAt) data.publishedAt = new Date();
        data.publishedById = actorId ?? existing.publishedById ?? null;
      }
    }
    const updated = await this.prisma.announcement.update({ where: { id }, data });
    return this.map(updated);
  }

  async remove(id: string) {
    await this.prisma.announcement.delete({ where: { id } });
    return { id, ok: true };
  }
}
